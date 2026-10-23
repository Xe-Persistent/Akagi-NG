import type {
  OnlineHealth,
  OnlineKeyInfo,
  OnlineKeyStatus,
  OnlineModel,
  OnlinePurchaseStatus,
  OnlineRedeemResult,
  OnlineResult,
} from '@/types';

/**
 * Thin wrappers over the `online:*` channels. The API key is written in the main
 * process and never comes back through these calls: only whether it exists and
 * its last four characters.
 */
export function fetchKeyInfoApi(): Promise<OnlineKeyInfo> {
  return window.electron.invoke<OnlineKeyInfo>('online:key-info');
}

export function saveKeyApi(key: string): Promise<OnlineResult<OnlineKeyStatus>> {
  return window.electron.invoke<OnlineResult<OnlineKeyStatus>>('online:set-key', key);
}

export function clearKeyApi(): Promise<OnlineKeyInfo> {
  return window.electron.invoke<OnlineKeyInfo>('online:clear-key');
}

export function fetchKeyStatusApi(): Promise<OnlineResult<OnlineKeyStatus>> {
  return window.electron.invoke<OnlineResult<OnlineKeyStatus>>('online:key-status');
}

export function fetchOnlineModelsApi(): Promise<OnlineResult<OnlineModel[]>> {
  return window.electron.invoke<OnlineResult<OnlineModel[]>>('online:models');
}

export function fetchHealthApi(): Promise<OnlineResult<OnlineHealth>> {
  return window.electron.invoke<OnlineResult<OnlineHealth>>('online:health');
}

export function redeemApi(
  code: string,
  email?: string,
  renew?: boolean,
): Promise<OnlineResult<OnlineRedeemResult>> {
  return window.electron.invoke<OnlineResult<OnlineRedeemResult>>(
    'online:redeem',
    code,
    email,
    renew === true,
  );
}

export function startPurchaseApi(product: string): Promise<OnlineResult<{ checkoutUrl: string }>> {
  return window.electron.invoke<OnlineResult<{ checkoutUrl: string }>>(
    'online:start-purchase',
    product,
  );
}

export function pollPurchaseApi(): Promise<OnlineResult<OnlinePurchaseStatus>> {
  return window.electron.invoke<OnlineResult<OnlinePurchaseStatus>>('online:poll-purchase');
}

/** A checkout started earlier and not yet collected, if there is one. */
export function fetchPendingPurchaseApi(): Promise<OnlineResult<{ product: string } | null>> {
  return window.electron.invoke<OnlineResult<{ product: string } | null>>(
    'online:pending-purchase',
  );
}
