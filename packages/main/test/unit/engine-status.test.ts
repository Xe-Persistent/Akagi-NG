import { beforeEach, describe, expect, it } from 'vitest';

import { EngineStatusStore } from '../../src/services/engine-status.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';

interface BroadcastStatus {
  connection: string;
  model: string;
  modelName: string | null;
  notice: { kind: string; seq: number } | null;
}

const broadcasts = () => messagesOn<BroadcastStatus>('engine:status');

describe('the engine status store', () => {
  let store: EngineStatusStore;

  beforeEach(() => {
    resetSentMessages();
    store = new EngineStatusStore();
  });

  it('starts idle and says nothing until something changes', () => {
    expect(store.get()).toEqual({
      connection: 'idle',
      model: 'idle',
      modelName: null,
      notice: null,
    });
    expect(broadcasts()).toHaveLength(0);
  });

  it('mirrors a change to the windows', () => {
    store.set({ connection: 'connected' });

    expect(broadcasts()).toEqual([
      { connection: 'connected', model: 'idle', modelName: null, notice: null },
    ]);
  });

  it('stays quiet when a patch repeats the state', () => {
    store.set({ connection: 'connected', model: 'loading' });
    resetSentMessages();

    store.set({ connection: 'connected', model: 'loading' });
    store.set({ connection: 'connected' });

    expect(broadcasts()).toHaveLength(0);
  });

  it('does not mutate the snapshot an earlier caller holds', () => {
    const before = store.get();

    store.set({ model: 'ready', modelName: 'akagi4p.safetensors' });

    expect(before.model).toBe('idle');
    expect(store.get()).toMatchObject({ model: 'ready', modelName: 'akagi4p.safetensors' });
  });

  it('numbers each notice so a repeat is visible', () => {
    store.notice('parse_error');
    store.notice('parse_error');

    const notices = broadcasts().map((status) => status.notice);
    expect(notices.map((notice) => notice?.seq)).toEqual([1, 2]);
    expect(notices.map((notice) => notice?.kind)).toEqual(['parse_error', 'parse_error']);
  });

  it('keeps the notice in the snapshot until the next one', () => {
    store.notice('replay');
    store.set({ model: 'ready' });

    expect(store.get().notice).toMatchObject({ kind: 'replay', seq: 1 });
    expect(store.get().model).toBe('ready');
  });

  it('broadcasts the reset', () => {
    store.set({ connection: 'connected', model: 'ready' });
    resetSentMessages();

    store.reset();

    expect(broadcasts()).toEqual([
      { connection: 'idle', model: 'idle', modelName: null, notice: null },
    ]);
  });
});
