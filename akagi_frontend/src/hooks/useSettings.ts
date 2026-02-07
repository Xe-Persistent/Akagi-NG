import { use } from 'react';

import { SettingsContext } from '@/contexts/SettingsContext';
import { fetchJson } from '@/lib/api-client';
import type { SaveSettingsResponse, Settings } from '@/types';

export async function fetchSettingsApi(): Promise<Settings> {
  for (let i = 0; i < 20; i++) {
    try {
      return await fetchJson<Settings>(`/api/settings`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
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

export function useSettings() {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
