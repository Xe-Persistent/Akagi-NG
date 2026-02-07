import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react';

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

// --- Types & Reducer ---

type SaveStatus = 'saved' | 'saving' | 'error';

interface State {
  settings: Settings;
  saveStatus: SaveStatus;
  restartRequired: boolean;
  // 'lastUpdatedBy' helps us distinguish who triggered the change
  // to decide if we should save/broadcast.
  lastUpdatedBy: 'init' | 'user' | 'remote' | 'restore';
  // A timestamp or ID to trigger side effects
  updateId: number;
  // Controls if the current pending save should be debounced
  saveDebounceMode: boolean;
}

type Action =
  | { type: 'INIT_SYNC'; payload: Settings }
  | { type: 'REMOTE_UPDATE'; payload: { locale: string } }
  | { type: 'USER_UPDATE'; path: readonly string[]; value: unknown; shouldDebounce?: boolean }
  | {
      type: 'USER_UPDATE_BATCH';
      updates: { path: readonly string[]; value: unknown }[];
      shouldDebounce?: boolean;
    }
  | { type: 'RESTORE_START' }
  | { type: 'RESTORE_SUCCESS'; payload: Settings }
  | { type: 'SET_SAVE_STATUS'; status: SaveStatus }
  | { type: 'SET_RESTART_REQUIRED' };

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
        lastUpdatedBy: 'init',
        updateId: state.updateId + 1,
        saveDebounceMode: false,
      };

    case 'REMOTE_UPDATE':
      if (state.settings.locale === action.payload.locale) return state;
      return {
        ...state,
        settings: { ...state.settings, locale: action.payload.locale },
        lastUpdatedBy: 'remote',
        updateId: state.updateId + 1,
        saveDebounceMode: false,
      };

    case 'USER_UPDATE': {
      const nextSettings = structuredClone(state.settings) as unknown as Record<string, unknown>;
      setByPath(nextSettings, action.path, action.value);
      return {
        ...state,
        settings: nextSettings as unknown as Settings,
        lastUpdatedBy: 'user',
        updateId: state.updateId + 1,
        saveDebounceMode: action.shouldDebounce ?? false,
      };
    }

    case 'USER_UPDATE_BATCH': {
      const nextSettings = structuredClone(state.settings) as unknown as Record<string, unknown>;
      action.updates.forEach(({ path, value }) => setByPath(nextSettings, path, value));
      return {
        ...state,
        settings: nextSettings as unknown as Settings,
        lastUpdatedBy: 'user',
        updateId: state.updateId + 1,
        saveDebounceMode: action.shouldDebounce ?? false,
      };
    }

    case 'RESTORE_SUCCESS':
      return {
        ...state,
        settings: action.payload,
        restartRequired: true,
        lastUpdatedBy: 'restore',
        updateId: state.updateId + 1,
        saveDebounceMode: false,
      };

    case 'SET_SAVE_STATUS':
      return { ...state, saveStatus: action.status };

    case 'SET_RESTART_REQUIRED':
      return { ...state, restartRequired: true };

    default:
      return state;
  }
}

// --- Component ---

interface SettingsProviderProps {
  children: ReactNode;
  apiBase: string;
  initialSettings: Settings;
}

export function SettingsProvider({ children, apiBase, initialSettings }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, {
    settings: initialSettings,
    saveStatus: 'saved',
    restartRequired: false,
    lastUpdatedBy: 'init',
    updateId: 0,
    saveDebounceMode: false,
  });

  const { settings, saveStatus, restartRequired, lastUpdatedBy, updateId, saveDebounceMode } =
    state;
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const toastId = useRef<string | number | null>(null);

  // --- Effects: Logic ---

  // 1. Sync Prop changes (Initial Load / Backgound Re-fetch)
  // safe due to check inside reducer
  useEffect(() => {
    dispatch({ type: 'INIT_SYNC', payload: initialSettings });
  }, [initialSettings]);

  // 2. Handle Side Effects (Save & Broadcast) when 'user' updates
  useEffect(() => {
    if (lastUpdatedBy !== 'user') return;

    // A. Saving
    const performSave = async () => {
      dispatch({ type: 'SET_SAVE_STATUS', status: 'saving' });

      // Toast UI
      if (toastId.current) {
        notify.update(toastId.current, {
          render: i18n.t('settings.status_saving'),
          isLoading: true,
        });
      } else {
        toastId.current = notify.loading(i18n.t('settings.status_saving'));
      }

      try {
        const result = await saveSettingsApi(settings);
        if (result.restartRequired) dispatch({ type: 'SET_RESTART_REQUIRED' });

        dispatch({ type: 'SET_SAVE_STATUS', status: 'saved' });
        if (toastId.current !== null) {
          notify.update(toastId.current, {
            render: i18n.t('settings.status_saved'),
            type: 'success',
            isLoading: false,
            autoClose: 2000,
          });
          toastId.current = null;
        }
      } catch (e) {
        console.error('Save error:', e);
        dispatch({ type: 'SET_SAVE_STATUS', status: 'error' });
        if (toastId.current !== null) {
          notify.update(toastId.current, {
            render: i18n.t('settings.status_error'),
            type: 'error',
            isLoading: false,
            autoClose: TOAST_DURATION_DEFAULT,
          });
          toastId.current = null;
        }
      }
    };

    // Debounce Logic
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (saveDebounceMode) {
      debounceTimer.current = setTimeout(performSave, SETTINGS_DEBOUNCE_MS);
    } else {
      performSave().catch(console.error);
    }

    // Cleanup
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [settings, lastUpdatedBy, updateId, saveDebounceMode, apiBase]);

  // 3. i18n Synchronization & Broadcasting
  // This effect ensures UI translation matches State, AND handles broadcasting
  useEffect(() => {
    const targetLocale = settings?.locale;
    if (!targetLocale) return;

    // Always keep local engine in sync
    if (i18n.language !== targetLocale) {
      i18n.changeLanguage(targetLocale).catch(console.error);
    }

    // Only broadcast if the change came from USER interaction in THIS window
    if (lastUpdatedBy === 'user') {
      window.electron.invoke('update-locale', targetLocale).catch(console.error);
    }
  }, [settings.locale, lastUpdatedBy]); // updateId not needed, settings.locale stable enough

  // 4. Remote Listener (IPC)
  useEffect(() => {
    const unsub = window.electron.on('locale-changed', (newLocale) => {
      if (typeof newLocale === 'string') {
        dispatch({ type: 'REMOTE_UPDATE', payload: { locale: newLocale } });
      }
    });
    return () => unsub();
  }, []);

  // 5. Initial Model Fetch
  useEffect(() => {
    fetchModelsApi().then(setAvailableModels).catch(console.error);
  }, []);

  // --- Public API ---

  const refreshSettings = useCallback(async () => {
    try {
      const [data, models] = await Promise.all([fetchSettingsApi(), fetchModelsApi()]);
      dispatch({ type: 'INIT_SYNC', payload: data });
      setAvailableModels(models);
    } catch (e) {
      console.error('Failed to refresh settings or models:', e);
    }
  }, []);

  const restoreDefaults = useCallback(async () => {
    try {
      const data = await resetSettingsApi();
      dispatch({ type: 'RESTORE_SUCCESS', payload: data });
      notify.success(i18n.t('settings.restored_success'));
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
      dispatch({ type: 'USER_UPDATE', path, value, shouldDebounce });
    },
    [],
  );

  const updateSettingsBatch = useCallback(
    (updates: { path: readonly string[]; value: unknown }[], shouldDebounce = false) => {
      dispatch({ type: 'USER_UPDATE_BATCH', updates, shouldDebounce });
    },
    [],
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        saveStatus,
        restartRequired,
        updateSetting,
        updateSettingsBatch,
        restoreDefaults,
        refreshSettings,
        availableModels,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
