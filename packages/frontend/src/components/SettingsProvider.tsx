import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { SETTINGS_DEBOUNCE_MS, TOAST_DURATION_DEFAULT } from '@/config/constants';
import { SettingsContext } from '@/contexts/SettingsContext';
import i18n from '@/i18n/i18n';
import { notify } from '@/lib/notify';
import {
  fetchModelsApi,
  fetchSettingsApi,
  resetSettingsApi,
  saveSettingsApi,
} from '@/lib/settings-api';
import type { Paths, PathValue, Settings } from '@/types';

// --- 类型与归约器 ---

interface State {
  settings: Settings;
  /** Bumped by every local edit; the save effect watches it. */
  revision: number;
  isRestored: boolean;
  availableModels: string[];
}

type Action =
  | { type: 'SYNC'; payload: Settings; revision?: number }
  | { type: 'REMOTE_UPDATE'; payload: { locale: string } }
  | { type: 'USER_UPDATE'; path: readonly string[]; value: unknown }
  | { type: 'RESTORE_SUCCESS'; payload: Settings }
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
    case 'SYNC':
      // A response for an older edit must not undo a newer one.
      if (action.revision !== undefined && action.revision !== state.revision) return state;
      if (JSON.stringify(state.settings) === JSON.stringify(action.payload)) return state;
      return { ...state, settings: action.payload };

    case 'REMOTE_UPDATE':
      if (state.settings.locale === action.payload.locale) return state;
      return { ...state, settings: { ...state.settings, locale: action.payload.locale } };

    case 'USER_UPDATE': {
      const nextSettings = structuredClone(state.settings) as unknown as Record<string, unknown>;
      setByPath(nextSettings, action.path, action.value);
      return {
        ...state,
        settings: nextSettings as unknown as Settings,
        revision: state.revision + 1,
        isRestored: false,
      };
    }

    case 'RESTORE_SUCCESS':
      return { ...state, settings: action.payload, isRestored: true };

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
    revision: 0,
    isRestored: false,
    availableModels: [],
  });

  const { settings, revision, isRestored, availableModels } = state;

  const settingsRef = useRef(settings);
  const revisionRef = useRef(revision);
  /** Highest revision the store has confirmed; guards a refresh over unsaved edits. */
  const savedRevisionRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef<string | number | null>(null);
  const saveSeqRef = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
    revisionRef.current = revision;
  }, [settings, revision]);

  // --- Effects ---

  // 1. 同步外部属性变更（初次加载/后台刷新）
  useEffect(() => {
    dispatch({ type: 'SYNC', payload: initialSettings });
  }, [initialSettings]);

  // 2. i18n 同步与广播
  // 保持界面语言与状态一致
  useEffect(() => {
    if (i18n.language !== settings.locale) {
      i18n.changeLanguage(settings.locale).catch(console.error);
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

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const persist = useCallback(async (revisionToSave: number) => {
    // A newer save supersedes this one; its response is discarded below.
    const saveId = ++saveSeqRef.current;
    const payload = settingsRef.current;

    if (toastIdRef.current === null) {
      toastIdRef.current = notify.loading(i18n.t('settings.status_saving'));
    } else {
      notify.update(toastIdRef.current, {
        render: i18n.t('settings.status_saving'),
        type: 'info',
        isLoading: true,
        autoClose: false,
      });
    }

    try {
      const saved = await saveSettingsApi(payload);
      if (saveId !== saveSeqRef.current) return;

      savedRevisionRef.current = revisionToSave;
      dispatch({ type: 'SYNC', payload: saved, revision: revisionToSave });

      if (toastIdRef.current !== null) {
        notify.update(toastIdRef.current, {
          render: i18n.t('settings.status_saved'),
          type: 'success',
          isLoading: false,
          autoClose: 2000,
        });
        toastIdRef.current = null;
      }
    } catch (error) {
      if (saveId !== saveSeqRef.current) return;
      console.error('Save error:', error);
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
  }, []);

  // 5. 本地修改后防抖保存
  useEffect(() => {
    if (revision === 0) return;

    cancelPendingSave();
    const timer = setTimeout(() => {
      saveTimerRef.current = null;
      void persist(revision);
    }, SETTINGS_DEBOUNCE_MS);
    saveTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
    };
  }, [revision, persist, cancelPendingSave]);

  // --- 对外接口 ---

  const refreshSettings = useCallback(async () => {
    // Never clobber an edit whose debounced save has not landed yet.
    if (revisionRef.current !== savedRevisionRef.current) return;

    try {
      const [data, models] = await Promise.all([fetchSettingsApi(), fetchModelsApi()]);
      dispatch({ type: 'SYNC', payload: data });
      dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models });
    } catch (error) {
      console.error('Failed to refresh settings or models:', error);
    }
  }, []);

  const restoreDefaults = useCallback(async () => {
    try {
      // A pending edit would otherwise be saved right after the reset.
      cancelPendingSave();
      saveSeqRef.current++;

      const data = await resetSettingsApi();
      savedRevisionRef.current = revisionRef.current;
      dispatch({ type: 'RESTORE_SUCCESS', payload: data });
    } catch (error) {
      console.error('Restore Defaults error:', error);
    }
  }, [cancelPendingSave]);

  const updateSetting = useCallback(
    <P extends Paths<Settings>>(path: readonly [...P], value: PathValue<Settings, P>) => {
      dispatch({ type: 'USER_UPDATE', path, value });
    },
    [],
  );

  const contextValue = useMemo(
    () => ({
      settings,
      isRestored,
      updateSetting,
      restoreDefaults,
      refreshSettings,
      availableModels,
    }),
    [settings, isRestored, updateSetting, restoreDefaults, refreshSettings, availableModels],
  );

  return <SettingsContext value={contextValue}>{children}</SettingsContext>;
}
