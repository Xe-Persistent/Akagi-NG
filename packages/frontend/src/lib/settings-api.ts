import type { Settings } from '@/types';

/** Thin wrappers over the settings IPC channels; the provider owns the state. */
export function fetchSettingsApi(): Promise<Settings> {
  return window.electron.invoke<Settings>('settings:get');
}

export async function saveSettingsApi(settings: Settings): Promise<Settings> {
  const result = await window.electron.invoke<{ success: boolean; error?: string }>(
    'settings:update',
    settings,
  );
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to save settings');
  }
  return fetchSettingsApi();
}

export function resetSettingsApi(): Promise<Settings> {
  return window.electron.invoke<Settings>('settings:reset');
}

export function fetchModelsApi(): Promise<string[]> {
  return window.electron.invoke<string[]>('settings:get-models');
}
