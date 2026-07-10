import { use } from 'react';

import { SettingsContext } from '@/contexts/SettingsContext';
import { fetchJson } from '@/lib/api-client';
import type {
  ApiHealth,
  ApiKeyStatus,
  ApiModelInfo,
  ApiRedeemResponse,
  SaveSettingsResponse,
  Settings,
} from '@/types';

export async function fetchSettingsApi(): Promise<Settings> {
  return fetchJson<Settings>(`/api/settings`);
}

export async function saveSettingsApi(settings: Settings): Promise<SaveSettingsResponse> {
  return await fetchJson(`/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function resetSettingsApi(): Promise<Settings> {
  return fetchJson<Settings>(`/api/settings/reset`, { method: 'POST' });
}

export async function fetchModelsApi(): Promise<string[]> {
  return fetchJson<string[]>(`/api/models`);
}

function cloudPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  return fetchJson<T>(`/api/cloud/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function checkCloudHealth(baseUrl: string): Promise<ApiHealth> {
  return cloudPost<ApiHealth>('health', { base_url: baseUrl });
}

export function checkCloudKey(baseUrl: string, key: string): Promise<ApiKeyStatus> {
  return cloudPost<ApiKeyStatus>('key-status', { base_url: baseUrl, key });
}

export function fetchCloudModels(baseUrl: string, key: string): Promise<ApiModelInfo[]> {
  return cloudPost<ApiModelInfo[]>('models', { base_url: baseUrl, key });
}

export function redeemCloudCode(
  baseUrl: string,
  code: string,
  email?: string,
  renewKey?: string,
): Promise<ApiRedeemResponse> {
  return cloudPost<ApiRedeemResponse>('redeem', {
    base_url: baseUrl,
    code,
    email,
    renew_key: renewKey,
  });
}

export function useSettings() {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
