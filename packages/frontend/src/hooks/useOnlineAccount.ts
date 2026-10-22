import { useCallback, useEffect, useState } from 'react';

import {
  clearKeyApi,
  fetchHealthApi,
  fetchKeyInfoApi,
  fetchKeyStatusApi,
  fetchOnlineModelsApi,
  saveKeyApi,
} from '@/lib/online-api';
import type { OnlineHealth, OnlineKeyInfo, OnlineKeyStatus, OnlineModel } from '@/types';

export interface OnlineAccount {
  keyInfo: OnlineKeyInfo | null;
  keyStatus: OnlineKeyStatus | null;
  models: OnlineModel[];
  health: OnlineHealth | null;
  busy: 'key' | 'health' | null;
  keyError: string | null;
  healthError: string | null;
  /** Unknown until the first read comes back, so the panel never guesses. */
  configured: boolean;
  last4: string;
  reload: () => Promise<void>;
  /** Resolves to whether the key was stored, so the editor knows to close. */
  saveKey: (draft: string) => Promise<boolean>;
  clearKey: () => Promise<void>;
  checkHealth: () => Promise<void>;
}

/**
 * The key's plan, its limits and the models it may use. Read while the online
 * model is on, and again after a key changes, which is when any of it can have
 * changed — there is no separate "check" action to press.
 *
 * A stored key can stop working (expired, revoked, rate limited), and this is
 * the only place that would notice: say so instead of leaving the panel looking
 * healthy while every move quietly falls back to the local model.
 */
export function useOnlineAccount(enabled: boolean): OnlineAccount {
  const [keyInfo, setKeyInfo] = useState<OnlineKeyInfo | null>(null);
  const [keyStatus, setKeyStatus] = useState<OnlineKeyStatus | null>(null);
  const [models, setModels] = useState<OnlineModel[]>([]);
  const [health, setHealth] = useState<OnlineHealth | null>(null);
  const [busy, setBusy] = useState<'key' | 'health' | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let info: OnlineKeyInfo;
    try {
      info = await fetchKeyInfoApi();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
      return;
    }
    setKeyInfo(info);
    if (!info.configured) return;

    const [status, list] = await Promise.all([fetchKeyStatusApi(), fetchOnlineModelsApi()]);
    if (status.success && status.data) setKeyStatus(status.data);
    if (list.success && list.data) setModels(list.data);
    if (!status.success) setKeyError(status.error ?? '');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  const saveKey = useCallback(
    async (draft: string) => {
      setBusy('key');
      setKeyError(null);
      const result = await saveKeyApi(draft);
      setBusy(null);

      if (!result.success) {
        setKeyError(result.error ?? '');
        return false;
      }
      // The old key's models may not be granted by the new one.
      setModels([]);
      await reload();
      return true;
    },
    [reload],
  );

  const clearKey = useCallback(async () => {
    setKeyError(null);
    setKeyInfo(await clearKeyApi());
    setKeyStatus(null);
    setModels([]);
  }, []);

  const checkHealth = useCallback(async () => {
    setBusy('health');
    setHealthError(null);
    const result = await fetchHealthApi();
    setBusy(null);
    if (result.success && result.data) {
      setHealth(result.data);
    } else {
      setHealthError(result.error ?? '');
    }
  }, []);

  return {
    keyInfo,
    keyStatus,
    models,
    health,
    busy,
    keyError,
    healthError,
    configured: keyInfo?.configured ?? false,
    last4: keyInfo?.last4 ?? '',
    reload,
    saveKey,
    clearKey,
    checkHealth,
  };
}
