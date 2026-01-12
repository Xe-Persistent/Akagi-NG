import { useCallback, useRef, useState } from 'react';
import { notify } from '@/lib/notify';
import { useTranslation } from 'react-i18next';
import { fetchJson } from '@/lib/api-client';
import { SETTINGS_DEBOUNCE_MS } from '@/config/constants';
import type { ApiResponse, Paths, PathValue, Settings } from '@/types';

type SaveSettingsResponse = ApiResponse & { restartRequired?: boolean };

export async function fetchSettingsApi(apiBase: string): Promise<Settings> {
  return fetchJson<Settings>(`${apiBase}/api/settings`);
}

export async function saveSettingsApi(
  apiBase: string,
  settings: Settings,
): Promise<SaveSettingsResponse> {
  return await fetchJson(`${apiBase}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function resetSettingsApi(apiBase: string): Promise<Settings> {
  return fetchJson<Settings>(`${apiBase}/api/settings/reset`, { method: 'POST' });
}

function setByPath(root: Record<string, unknown>, path: readonly string[], value: unknown) {
  let current: Record<string, unknown> = root;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = current[key];

    if (typeof next !== 'object' || next === null) {
      current[key] = {};
    }

    current = current[key] as Record<string, unknown>;
  }

  current[path[path.length - 1]] = value;
}

export function useSettings(apiBase: string, initialSettings: Settings) {
  const [settings, setSettings] = useState<Settings | null>(initialSettings);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [restartRequired, setRestartRequired] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout>(null);
  const toastId = useRef<string | number>(null);

  const { t } = useTranslation();

  const performSave = useCallback(
    async (newSettings: Settings) => {
      setSaveStatus('saving');
      if (toastId.current) {
        notify.update(toastId.current, {
          render: t('settings.status_saving'),
          isLoading: true,
        });
      } else {
        toastId.current = notify.loading(t('settings.status_saving'));
      }

      try {
        const result = await saveSettingsApi(apiBase, newSettings);
        if (result.restartRequired) {
          setRestartRequired(true);
        }
        setSaveStatus('saved');
        if (toastId.current !== null) {
          notify.update(toastId.current, {
            render: t('settings.status_saved'),
            type: 'success',
            isLoading: false,
            autoClose: 2000,
          });
          toastId.current = null;
        }
      } catch (e) {
        console.error('Save error:', e);
        setSaveStatus('error');
        if (toastId.current !== null) {
          notify.update(toastId.current, {
            render: t('settings.status_error'),
            type: 'error',
            isLoading: false,
            autoClose: 5000,
          });
          toastId.current = null;
        }
      }
    },
    [apiBase],
  );

  const triggerSave = useCallback(
    (newSettings: Settings, debounce = false) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }

      if (debounce) {
        setSaveStatus('saving');
        debounceTimer.current = setTimeout(() => {
          performSave(newSettings);
        }, SETTINGS_DEBOUNCE_MS);
      } else {
        performSave(newSettings);
      }
    },
    [performSave],
  );

  const performAction = useCallback(
    async <T>(
      action: () => Promise<T>,
      onSuccess: (data: T) => void,
      errorMessagePrefix: string,
    ) => {
      try {
        const result = await action();
        onSuccess(result);
      } catch (e) {
        console.error(`${errorMessagePrefix} error:`, e);
      }
    },
    [],
  );

  const restoreDefaults = useCallback(() => {
    performAction(
      () => resetSettingsApi(apiBase),
      (data) => {
        setSettings(data);
        setRestartRequired(true);
        notify.success(t('settings.restored_success'));
      },
      'Restore Defaults',
    );
  }, [apiBase, performAction, t]);

  const updateSetting = useCallback(
    <P extends Paths<Settings>>(
      path: readonly [...P],
      value: PathValue<Settings, P>,
      shouldDebounce = false,
    ) => {
      setSettings((prev) => {
        if (!prev) return null;

        const next = structuredClone(prev) as unknown as Record<string, unknown>;
        setByPath(next, path as readonly string[], value);

        const nextSettings = next as unknown as Settings;
        triggerSave(nextSettings, shouldDebounce);
        return nextSettings;
      });
    },
    [triggerSave],
  );

  /**
   * 批量更新多个设置项。
   *
   * 注意：此方法的类型签名使用 `readonly string[]` 和 `unknown`，
   * 因为 TypeScript 的类型系统难以在数组中表达多个不同路径的严格类型约束。
   * 单个设置更新请使用类型安全的 `updateSetting` 方法。
   */
  const updateSettingsBatch = useCallback(
    (updates: { path: readonly string[]; value: unknown }[], shouldDebounce = false) => {
      setSettings((prev) => {
        if (!prev) return null;

        const next = structuredClone(prev) as unknown as Record<string, unknown>;
        updates.forEach(({ path, value }) => setByPath(next, path, value));

        const nextSettings = next as unknown as Settings;
        triggerSave(nextSettings, shouldDebounce);
        return nextSettings;
      });
    },
    [triggerSave],
  );

  return {
    settings,
    saveStatus,
    restartRequired,
    updateSetting,
    updateSettingsBatch,
    restoreDefaults,
  };
}
