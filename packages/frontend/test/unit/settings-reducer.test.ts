import { describe, expect, it } from 'vitest';

import { createSettingsState, settingsReducer } from '@/lib/settings-reducer';
import type { Settings } from '@/types';

const settings: Settings = {
  log_level: 'info',
  locale: 'en-US',
  game_url: '',
  majsoul_server: 'cn',
  mitm: { enabled: false, host: '127.0.0.1', port: 23410, upstream: '' },
  model_config: { model_4p: 'a.safetensors', model_3p: '' },
};

const state = createSettingsState(settings);

describe('the settings reducer', () => {
  it('bumps the revision and clears the restore flag on a local edit', () => {
    const restored = settingsReducer(state, { type: 'RESTORE_SUCCESS', payload: settings });
    expect(restored.isRestored).toBe(true);

    const edited = settingsReducer(restored, {
      type: 'USER_UPDATE',
      path: ['mitm', 'port'],
      value: 1080,
    });

    expect(edited.settings.mitm.port).toBe(1080);
    expect(edited.revision).toBe(1);
    expect(edited.isRestored).toBe(false);
    // A nested edit must leave the rest of the section alone.
    expect(edited.settings.mitm.host).toBe('127.0.0.1');
    // And the previous state must not have been mutated in place.
    expect(state.settings.mitm.port).toBe(23410);
  });

  it('ignores a sync that is already what we hold', () => {
    expect(settingsReducer(state, { type: 'SYNC', payload: { ...settings } })).toBe(state);
  });

  it('takes a sync that carries no revision, so a refresh always lands', () => {
    const refreshed = { ...settings, log_level: 'debug' };
    const next = settingsReducer(state, { type: 'SYNC', payload: refreshed });

    expect(next.settings.log_level).toBe('debug');
  });

  it('drops a sync answering an older edit', () => {
    const edited = settingsReducer(state, {
      type: 'USER_UPDATE',
      path: ['log_level'],
      value: 'debug',
    });

    expect(
      settingsReducer(edited, { type: 'SYNC', payload: settings, revision: edited.revision - 1 }),
    ).toBe(edited);
    expect(
      settingsReducer(edited, { type: 'SYNC', payload: settings, revision: edited.revision })
        .settings,
    ).toEqual(settings);
  });

  it('applies a locale broadcast only when it changes something', () => {
    const same = settingsReducer(state, { type: 'REMOTE_UPDATE', payload: { locale: 'en-US' } });
    expect(same).toBe(state);

    const changed = settingsReducer(state, {
      type: 'REMOTE_UPDATE',
      payload: { locale: 'ja-JP' },
    });
    expect(changed.settings.locale).toBe('ja-JP');
    expect(changed.revision).toBe(state.revision);
  });

  it('keeps the model list the main process reports', () => {
    const next = settingsReducer(state, {
      type: 'SET_AVAILABLE_MODELS',
      payload: ['akagi4p.safetensors'],
    });

    expect(next.availableModels).toEqual(['akagi4p.safetensors']);
  });
});
