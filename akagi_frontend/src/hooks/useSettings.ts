import { useContext } from 'react';

import { SettingsContext } from '@/contexts/SettingsContext';
import { fetchJson } from '@/lib/api-client';
import type { SaveSettingsResponse, Settings } from '@/types';

export async function fetchSettingsApi(apiBase: string): Promise<Settings> {
  for (let i = 0; i < 20; i++) {
    try {
      return await fetchJson<Settings>(`${apiBase}/api/settings`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
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

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
