import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { onLocaleChanged } from '@/api/events';
import {
  fetchModelsApi,
  fetchSettingsApi,
  resetSettingsApi,
  saveSettingsApi,
} from '@/api/settings';
import { SETTINGS_DEBOUNCE_MS, TOAST_DURATION_DEFAULT } from '@/config/constants';
import { SettingsContext } from '@/contexts/SettingsContext';
import i18n from '@/i18n/i18n';
import { notify } from '@/lib/notify';
import { createSettingsState, settingsReducer } from '@/lib/settings-reducer';
import type { Paths, PathValue, Settings } from '@/types';

interface SettingsProviderProps {
  children: ReactNode;
  initialSettings: Settings;
}

export function SettingsProvider({ children, initialSettings }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, initialSettings, createSettingsState);

  const { settings, revision, isRestored, availableModels } = state;

  const revisionRef = useRef(revision);
  /** Highest revision the store has confirmed; guards a refresh over unsaved edits. */
  const savedRevisionRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef<string | number | null>(null);
  const saveSeqRef = useRef(0);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    dispatch({ type: 'SYNC', payload: initialSettings });
  }, [initialSettings]);

  useEffect(() => {
    if (i18n.language !== settings.locale) {
      i18n.changeLanguage(settings.locale).catch(console.error);
    }
  }, [settings.locale]);

  useEffect(() => {
    return onLocaleChanged((newLocale) => {
      dispatch({ type: 'REMOTE_UPDATE', payload: { locale: newLocale } });
    });
  }, []);

  useEffect(() => {
    fetchModelsApi()
      .then((models) => dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models }))
      .catch(console.error);
  }, []);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const persist = useEffectEvent(async (revisionToSave: number) => {
    // A newer save supersedes this one; its response is discarded below.
    const saveId = ++saveSeqRef.current;
    // Read at call time, so the debounced save always sends the newest settings.
    const payload = settings;

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
  });

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
  }, [revision, cancelPendingSave]);

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
