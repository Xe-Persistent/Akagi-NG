import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchModelsApi,
  fetchSettingsApi,
  resetSettingsApi,
  saveSettingsApi,
} from '@/api/settings';
import type { Settings } from '@/types';

const settings: Settings = {
  log_level: 'info',
  locale: 'en-US',
  game_url: 'https://game.maj-soul.com/1/',
  majsoul_server: 'cn',
  mitm: { enabled: false, port: 6789, upstream: '' },
  model_config: { model_4p: 'akagi4p.safetensors', model_3p: '' },
  ot: {
    online: false,
    server: 'https://mjapi.shinkuan.me',
    model_4p: '',
    model_3p: '',
    react_timeout_ms: 3000,
  },
};

/** Stands in for the preload bridge, recording the channels it was asked for. */
function stubElectron(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>) {
  const calls: string[] = [];
  vi.stubGlobal('window', {
    electron: {
      invoke: (channel: string, ...args: unknown[]) => {
        calls.push(channel);
        return invoke(channel, ...args);
      },
    },
  });
  return calls;
}

describe('the settings IPC wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the settings from the main process', async () => {
    const calls = stubElectron(async () => settings);

    await expect(fetchSettingsApi()).resolves.toEqual(settings);
    expect(calls).toEqual(['settings:get']);
  });

  it('reads the model list', async () => {
    stubElectron(async () => ['akagi4p.safetensors']);

    await expect(fetchModelsApi()).resolves.toEqual(['akagi4p.safetensors']);
  });

  it('resets through the same channel the store uses', async () => {
    const calls = stubElectron(async () => settings);

    await expect(resetSettingsApi()).resolves.toEqual(settings);
    expect(calls).toEqual(['settings:reset']);
  });

  it('sends the whole settings object and re-reads what the store kept', async () => {
    const stored = { ...settings, log_level: 'debug' };
    const sent: unknown[] = [];
    const calls = stubElectron(async (channel, ...args) => {
      if (channel === 'settings:update') {
        sent.push(args[0]);
        return { success: true };
      }
      return stored;
    });

    await expect(saveSettingsApi(settings)).resolves.toEqual(stored);
    expect(sent).toEqual([settings]);
    expect(calls).toEqual(['settings:update', 'settings:get']);
  });

  it('surfaces the message the main process rejected with', async () => {
    stubElectron(async (channel) =>
      channel === 'settings:update' ? { success: false, error: 'schema rejected' } : settings,
    );

    await expect(saveSettingsApi(settings)).rejects.toThrow('schema rejected');
  });

  it('falls back to a generic message when the rejection carries none', async () => {
    stubElectron(async () => ({ success: false }));

    await expect(saveSettingsApi(settings)).rejects.toThrow('Failed to save settings');
  });
});
