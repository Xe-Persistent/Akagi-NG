import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { SETTINGS_DEBOUNCE_MS, TOAST_DURATION_DEFAULT } from '@/config/constants';
import { SettingsContext } from '@/contexts/SettingsContext';
import {
  fetchModelsApi,
  fetchSettingsApi,
  resetSettingsApi,
  saveSettingsApi,
} from '@/hooks/useSettings';
import i18n from '@/i18n/i18n';
import { notify } from '@/lib/notify';
import type { Paths, PathValue, Settings } from '@/types';

// --- 类型与归约器 ---

type SaveStatus = 'saved' | 'saving' | 'error';

interface State {
  settings: Settings;
  saveStatus: SaveStatus;
  restartRequired: boolean;
  isRestored: boolean;
  // 可用模型列表
  availableModels: string[];
}

type Action =
  | { type: 'INIT_SYNC'; payload: Settings }
  | { type: 'REMOTE_UPDATE'; payload: { locale: string } }
  | { type: 'USER_UPDATE'; path: readonly string[]; value: unknown }
  | { type: 'RESTORE_START' }
  | { type: 'RESTORE_SUCCESS'; payload: Settings }
  | { type: 'SET_SAVE_STATUS'; status: SaveStatus }
  | { type: 'SET_RESTART_REQUIRED' }
  | { type: 'SET_AVAILABLE_MODELS'; payload: string[] };

function setByPath(root: Record<string, unknown>, path: readonly string[], value: unknown) {
  let current: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function settingsReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT_SYNC':
      if (JSON.stringify(state.settings) === JSON.stringify(action.payload)) {
        return state;
      }
      return {
        ...state,
        settings: action.payload,
      };

    case 'REMOTE_UPDATE':
      if (state.settings.locale === action.payload.locale) return state;
      return {
        ...state,
        settings: { ...state.settings, locale: action.payload.locale },
      };

    case 'USER_UPDATE': {
      const nextSettings = structuredClone(state.settings) as unknown as Record<string, unknown>;
      setByPath(nextSettings, action.path, action.value);
      return {
        ...state,
        settings: nextSettings as unknown as Settings,
      };
    }

    case 'RESTORE_SUCCESS':
      return {
        ...state,
        settings: action.payload,
        isRestored: true,
      };

    case 'SET_SAVE_STATUS':
      return { ...state, saveStatus: action.status };

    case 'SET_RESTART_REQUIRED':
      return { ...state, restartRequired: true };

    case 'SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.payload };

    default:
      return state;
  }
}

// --- 组件 ---

interface SettingsProviderProps {
  children: ReactNode;
  initialSettings: Settings;
}

export function SettingsProvider({ children, initialSettings }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, {
    settings: initialSettings,
    saveStatus: 'saved',
    restartRequired: false,
    isRestored: false,
    availableModels: [],
  });

  const { settings, saveStatus, restartRequired, isRestored, availableModels } = state;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef<string | number | null>(null);
  const saveSeqRef = useRef(0);

  // --- Effects ---

  // 1. 同步外部属性变更（初次加载/后台刷新）
  useEffect(() => {
    dispatch({ type: 'INIT_SYNC', payload: initialSettings });
  }, [initialSettings]);

  // 2. i18n 同步与广播
  // 保持界面语言与状态一致
  useEffect(() => {
    const targetLocale = settings?.locale;
    if (!targetLocale) return;

    // 本地引擎始终保持同步
    if (i18n.language !== targetLocale) {
      i18n.changeLanguage(targetLocale).catch(console.error);
    }
  }, [settings.locale]);

  // 3. 远程监听（进程间通信）
  useEffect(() => {
    const unsub = window.electron.on('locale-changed', (newLocale: string) => {
      dispatch({ type: 'REMOTE_UPDATE', payload: { locale: newLocale } });
    });
    return () => unsub();
  }, []);

  // 4. 初始模型列表获取
  useEffect(() => {
    fetchModelsApi()
      .then((models) => dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models }))
      .catch(console.error);
  }, []);

  // --- 核心方法 ---

  const triggerSave = useCallback((nextSettings: Settings) => {
    const performSave = async () => {
      const currentSaveId = ++saveSeqRef.current;
      dispatch({ type: 'SET_SAVE_STATUS', status: 'saving' });

      // 提示弹窗
      if (toastIdRef.current) {
        notify.update(toastIdRef.current, {
          render: i18n.t('settings.status_saving'),
          isLoading: true,
        });
      } else {
        toastIdRef.current = notify.loading(i18n.t('settings.status_saving'));
      }

      try {
        const result = await saveSettingsApi(nextSettings);
        if (currentSaveId !== saveSeqRef.current) return;
        if (result.data) dispatch({ type: 'INIT_SYNC', payload: result.data });

        dispatch({ type: 'SET_SAVE_STATUS', status: 'saved' });
        if (toastIdRef.current !== null) {
          notify.update(toastIdRef.current, {
            render: i18n.t('settings.status_saved'),
            type: 'success',
            isLoading: false,
            autoClose: 2000,
          });
          toastIdRef.current = null;
        }
      } catch (e) {
        if (currentSaveId !== saveSeqRef.current) return;
        console.error('Save error:', e);
        dispatch({ type: 'SET_SAVE_STATUS', status: 'error' });
        if (toastIdRef.current !== null) {
          notify.update(toastIdRef.current, {
            render: i18n.t('settings.status_error'),
            type: 'error',
            isLoading: false,
            autoClose: TOAST_DURATION_DEFAULT,
          });
          toastIdRef.current = null;
        }
      }
    };

    // 防抖逻辑
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(performSave, SETTINGS_DEBOUNCE_MS);
  }, []);

  // --- 对外接口 ---

  const refreshSettings = useCallback(async () => {
    try {
      const [data, models] = await Promise.all([fetchSettingsApi(), fetchModelsApi()]);
      dispatch({ type: 'INIT_SYNC', payload: data });
      dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models });
    } catch (e) {
      console.error('Failed to refresh settings or models:', e);
    }
  }, []);

  const restoreDefaults = useCallback(async () => {
    try {
      const data = await resetSettingsApi();
      dispatch({ type: 'RESTORE_SUCCESS', payload: data });
    } catch (e) {
      console.error('Restore Defaults error:', e);
    }
  }, []);

  const updateSetting = useCallback(
    <P extends Paths<Settings>>(
      path: readonly [...P],
      value: PathValue<Settings, P>,
      shouldDebounce = false,
    ) => {
      dispatch({ type: 'USER_UPDATE', path, value });

      // 计算变更后的设置用于触发保存
      const nextSettings = structuredClone(settings) as unknown as Record<string, unknown>;
      setByPath(nextSettings, path, value);

      const localePath =
        path.length > 0 && path[0] === 'locale' && value && typeof value === 'string';
      if (localePath) {
        window.electron.invoke('update-locale', value).catch(console.error);
      }

      if (shouldDebounce) {
        triggerSave(nextSettings as unknown as Settings);
      } else {
        // 立即保存时我们走防抖为 0 即可
        triggerSave(nextSettings as unknown as Settings);
      }
    },
    [settings, triggerSave],
  );

  const contextValue = useMemo(
    () => ({
      settings,
      saveStatus,
      restartRequired,
      isRestored,
      updateSetting,
      restoreDefaults,
      refreshSettings,
      availableModels,
    }),
    [
      settings,
      saveStatus,
      restartRequired,
      isRestored,
      updateSetting,
      restoreDefaults,
      refreshSettings,
      availableModels,
    ],
  );

  return <SettingsContext value={contextValue}>{children}</SettingsContext>;
}
