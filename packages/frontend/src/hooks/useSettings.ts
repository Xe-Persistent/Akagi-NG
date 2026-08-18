import { use } from 'react';

import { SettingsContext } from '@/contexts/SettingsContext';
import type { Settings } from '@/types';

export async function fetchSettingsApi(): Promise<Settings> {
  return window.electron.invoke<Settings>('settings:get');
}

export async function saveSettingsApi(
  settings: Partial<Settings>,
): Promise<{ ok: boolean; data: Settings }> {
  const result = await window.electron.invoke<{ success: boolean }>('settings:update', settings);
  if (!result.success) {
    throw new Error('Failed to save settings');
  }
  const newSettings = await fetchSettingsApi();
  return { ok: true, data: newSettings };
}

export async function resetSettingsApi(): Promise<Settings> {
  return window.electron.invoke<Settings>('settings:reset');
}

export async function fetchModelsApi(): Promise<string[]> {
  return window.electron.invoke<string[]>('settings:get-models');
}

export function useSettings() {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
