/**
 * The online model's IPC surface. The renderer never sees a key: it goes in
 * through `online:set-key`, is validated before it is stored, and comes back as
 * "configured" plus four characters. Because that is the whole security story
 * of this channel group, the key's absence from every reply is asserted rather
 * than assumed.
 *
 * `fetch` is replaced at the boundary, so the client, the request shapes and the
 * error text are all the production ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerOnlineHandlers } from '../../src/app/ipc/online.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import {
  clearApiKey,
  clearSecret,
  readApiKey,
  writeApiKey,
} from '../../src/services/online/secret-store.js';
import type { KeyStatus, RemoteModel, ServerHealth } from '../../src/services/online/types.js';
import {
  invokeIpc,
  openedExternal,
  resetIpcListeners,
  resetOpenedExternal,
  safeStorage,
} from '../electron-stub.js';
import { useTempProjectRootForFile } from '../project-root.js';

const KEY = 'sk-live-0123456789abcdef';
const BASE = 'https://mjapi.shinkuan.me';

/** `/v3/key` on the wire; snake_case, which the client maps. */
const KEY_STATUS_WIRE = {
  plan: 'pro',
  expires_at: '2027-01-01T00:00:00Z',
  usage_today: 12,
  rpd: 1000,
  rpm: 60,
  topk: 5,
};

const KEY_STATUS: KeyStatus = {
  plan: 'pro',
  expiresAt: '2027-01-01T00:00:00Z',
  usageToday: 12,
  rpd: 1000,
  rpm: 60,
  topk: 5,
};

/** What a failure the settings page may show as-is looks like. */
interface OnlineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Route {
  status?: number;
  body?: unknown;
}

interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Answers by path and records every request. A function entry is re-evaluated
 * per call, which is what a poll turning `pending` into `ready` needs.
 */
function stubFetch(routes: Record<string, Route | (() => Route)>) {
  const calls: RecordedCall[] = [];

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const path = new URL(url).pathname;
    const entry = routes[path];
    const route = typeof entry === 'function' ? entry() : entry;
    if (!route) return new Response('{"error":"not found"}', { status: 404 });

    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return calls;
}

function stubEngine() {
  const engine = { refreshInferenceSource: vi.fn() };
  return engine as unknown as EngineService & typeof engine;
}

describe('the online IPC surface', () => {
  useTempProjectRootForFile('akagi-ipc-online');

  let engine: ReturnType<typeof stubEngine>;

  beforeEach(() => {
    resetIpcListeners();
    resetOpenedExternal();
    engine = stubEngine();
    registerOnlineHandlers(engine);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearApiKey();
    // A stored checkout outlives the manager that wrote it, so it goes too.
    clearSecret('creem_pending_checkout');
  });

  it('reports only whether a key exists and its last four characters', async () => {
    const before = await invokeIpc('online:key-info', { id: 1 });
    expect(before).toEqual({ configured: false, last4: '' });

    writeApiKey(KEY);
    const after = await invokeIpc<{ configured: boolean; last4: string }>('online:key-info');

    expect(after).toEqual({ configured: true, last4: 'cdef' });
    expect(JSON.stringify(after)).not.toContain(KEY);
  });

  describe('storing a key', () => {
    it('refuses anything that is not text', async () => {
      for (const value of ['', '   ', null, 42]) {
        const result = await invokeIpc<OnlineResult<KeyStatus>>('online:set-key', { id: 1 }, value);
        expect(result).toEqual({ success: false, error: 'The API key is empty' });
      }
      expect(readApiKey()).toBe('');
    });

    it('refuses to store a key when the platform has no secure storage', async () => {
      vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false);

      const result = await invokeIpc<OnlineResult<KeyStatus>>('online:set-key', { id: 1 }, KEY);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Secure credential storage is unavailable/);
      expect(readApiKey()).toBe('');
    });

    it('validates the key before it is stored, then announces the new source', async () => {
      const calls = stubFetch({ '/v3/key': { body: KEY_STATUS_WIRE } });
      writeApiKey('');

      const result = await invokeIpc<OnlineResult<KeyStatus>>('online:set-key', { id: 1 }, KEY);

      expect(result).toEqual({ success: true, data: KEY_STATUS });
      expect(calls[0]!.url).toBe(`${BASE}/v3/key`);
      expect(String(calls[0]!.headers.Authorization)).toContain(KEY);
      expect(readApiKey()).toBe(KEY);
      expect(engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
    });

    it('keeps the old key when the server rejects the new one', async () => {
      stubFetch({ '/v3/key': { status: 401, body: { error: 'invalid key' } } });
      writeApiKey('sk-old');

      const result = await invokeIpc<OnlineResult<KeyStatus>>('online:set-key', { id: 1 }, KEY);

      expect(result).toMatchObject({ success: false });
      expect(result.error).toMatch(/Reading the key status failed|key status failed/);
      expect(readApiKey()).toBe('sk-old');
      expect(engine.refreshInferenceSource).not.toHaveBeenCalled();
    });
  });

  it('clears the key, its checkout and the answering source together', async () => {
    writeApiKey(KEY);

    const result = await invokeIpc('online:clear-key');

    expect(result).toEqual({ configured: false, last4: '' });
    expect(readApiKey()).toBe('');
    expect(engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
  });

  it('reads the plan for the stored key', async () => {
    const calls = stubFetch({ '/v3/key': { body: KEY_STATUS_WIRE } });
    writeApiKey(KEY);

    const result = await invokeIpc<OnlineResult<KeyStatus>>('online:key-status');

    expect(result).toEqual({ success: true, data: KEY_STATUS });
    expect(calls[0]!.method).toBe('GET');
  });

  it('lists the models the plan may use', async () => {
    stubFetch({
      '/v3/models': {
        body: { models: [{ id: 'mjot-4p', game: '4p', desc: 'default' }, { game: '4p' }] },
      },
    });
    writeApiKey(KEY);

    const result = await invokeIpc<OnlineResult<RemoteModel[]>>('online:models');

    // A row without an id is not addressable, so it is dropped rather than listed.
    expect(result.data).toEqual([{ id: 'mjot-4p', game: '4p', description: 'default' }]);
  });

  it('reports the service health without sending a key', async () => {
    const calls = stubFetch({
      '/healthz': {
        body: { status: 'ok', queue_depth: { '4p': 2, '3p': 1 }, workers_alive: true },
      },
    });
    writeApiKey(KEY);

    const result = await invokeIpc<OnlineResult<ServerHealth>>('online:health');

    expect(result).toEqual({
      success: true,
      data: { status: 'ok', queueDepth: 3, workersAlive: true },
    });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  describe('redeeming a code', () => {
    it('refuses an empty code', async () => {
      const result = await invokeIpc<OnlineResult<unknown>>('online:redeem', { id: 1 }, '  ');

      expect(result).toEqual({ success: false, error: 'The code is empty' });
    });

    it('stores a minted key and reports the plan the server confirms', async () => {
      stubFetch({
        '/v3/redeem': {
          body: { key: 'sk-minted-1234', key_last4: '1234', plan: 'pro', expires_at: 'soon' },
        },
        '/v3/key': { body: { ...KEY_STATUS_WIRE, plan: 'pro-yearly', expires_at: '2028-01-01' } },
      });

      const result = await invokeIpc<OnlineResult<Record<string, unknown>>>(
        'online:redeem',
        { id: 1 },
        'CODE-1',
        'buyer@example.test',
      );

      expect(result.data).toMatchObject({ keyLast4: '1234', plan: 'pro-yearly' });
      expect(JSON.stringify(result)).not.toContain('sk-minted-1234');
      expect(readApiKey()).toBe('sk-minted-1234');
      expect(engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
    });

    it('falls back to the redeem reply when the follow-up status call fails', async () => {
      let served = 0;
      stubFetch({
        '/v3/redeem': {
          body: { key: 'sk-minted-1234', key_last4: '1234', plan: 'pro', expires_at: '2028-05-05' },
        },
        '/v3/key': () => (served++ === 0 ? { status: 500, body: {} } : { body: {} }),
      });

      const result = await invokeIpc<OnlineResult<Record<string, unknown>>>(
        'online:redeem',
        { id: 1 },
        'CODE-1',
      );

      // The code is already spent, so a failed status call must not undo the redeem.
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ plan: 'pro', expiresAt: '2028-05-05' });
    });

    it('treats a renewal as an extension of the key it already holds', async () => {
      const calls = stubFetch({
        '/v3/redeem': {
          body: {
            key: null,
            key_last4: 'cdef',
            extended: true,
            plan: 'pro',
            expires_at: '2029-01-01',
          },
        },
        '/v3/key': { body: { ...KEY_STATUS_WIRE, expires_at: '2029-01-01' } },
      });
      writeApiKey(KEY);

      const result = await invokeIpc<OnlineResult<Record<string, unknown>>>(
        'online:redeem',
        { id: 1 },
        'RENEW-1',
        '',
        true,
      );

      expect(calls[0]!.body).toEqual({ code: 'RENEW-1', renew_key: KEY });
      expect(result.data).toMatchObject({ extended: true, expiresAt: '2029-01-01' });
      // A renewal returns no key, so the stored one has to survive untouched.
      expect(readApiKey()).toBe(KEY);
    });

    it('refuses to renew when there is no key to extend', async () => {
      stubFetch({});

      const result = await invokeIpc<OnlineResult<unknown>>(
        'online:redeem',
        { id: 1 },
        'RENEW-1',
        '',
        true,
      );

      expect(result).toEqual({ success: false, error: 'There is no stored key to renew' });
    });

    it('refuses a reply that carries neither a key nor an extension', async () => {
      stubFetch({ '/v3/redeem': { body: { key: null, extended: false } } });

      const result = await invokeIpc<OnlineResult<unknown>>('online:redeem', { id: 1 }, 'CODE-1');

      expect(result).toEqual({
        success: false,
        error: 'The code was accepted but no key was returned',
      });
      expect(readApiKey()).toBe('');
    });
  });

  describe('the Creem purchase flow', () => {
    const CHECKOUT = {
      checkout_id: 'ch_1',
      checkout_url: 'https://checkout.creem.io/ch_1',
      claim_secret: 'claim-1',
    };

    it('refuses an empty product', async () => {
      const result = await invokeIpc<OnlineResult<unknown>>('online:start-purchase', { id: 1 }, '');

      expect(result).toEqual({ success: false, error: 'Unknown product' });
    });

    it('opens the checkout link and remembers it', async () => {
      const calls = stubFetch({ '/creem/create-checkout': { body: CHECKOUT } });

      const started = await invokeIpc<OnlineResult<{ checkoutUrl: string }>>(
        'online:start-purchase',
        { id: 1 },
        'pro-30',
      );

      expect(started).toEqual({ success: true, data: { checkoutUrl: CHECKOUT.checkout_url } });
      expect(calls[0]!.body).toEqual({ product: 'pro-30', redeem: true });
      expect(openedExternal).toEqual([CHECKOUT.checkout_url]);

      expect(await invokeIpc('online:pending-purchase')).toEqual({
        success: true,
        data: { product: 'pro-30' },
      });
    });

    it('says there is nothing pending when no checkout was started', async () => {
      expect(await invokeIpc('online:pending-purchase')).toEqual({ success: true, data: null });
    });

    it('reports a poll that is still waiting without touching the source', async () => {
      stubFetch({
        '/creem/create-checkout': { body: CHECKOUT },
        '/creem/result': { body: { status: 'pending', plan: 'pro', days: 30 } },
      });
      await invokeIpc('online:start-purchase', { id: 1 }, 'pro-30');

      const polled = await invokeIpc<OnlineResult<Record<string, unknown>>>('online:poll-purchase');

      expect(polled.data).toMatchObject({ status: 'pending', stored: false });
      expect(engine.refreshInferenceSource).not.toHaveBeenCalled();
    });

    it('stores the key a settled purchase carries and announces the source', async () => {
      stubFetch({
        '/creem/create-checkout': { body: CHECKOUT },
        '/creem/result': {
          body: {
            status: 'ready',
            key: 'sk-bought-9999',
            plan: 'pro',
            expires_at: '2028-01-01',
            days: 30,
          },
        },
      });
      await invokeIpc('online:start-purchase', { id: 1 }, 'pro-30');

      const polled = await invokeIpc<OnlineResult<Record<string, unknown>>>('online:poll-purchase');

      expect(polled.data).toMatchObject({ status: 'ready', stored: true });
      expect(readApiKey()).toBe('sk-bought-9999');
      expect(engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
    });

    it('says so when there is no checkout to poll', async () => {
      const result = await invokeIpc<OnlineResult<Record<string, unknown>>>('online:poll-purchase');

      expect(result.data).toMatchObject({ status: 'unknown', message: 'No purchase in progress' });
    });

    it('shapes a service failure into something the dialog can show', async () => {
      stubFetch({ '/creem/create-checkout': { status: 503, body: { error: 'maintenance' } } });

      const result = await invokeIpc<OnlineResult<unknown>>(
        'online:start-purchase',
        { id: 1 },
        'pro-30',
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/checkout failed \(HTTP 503\): maintenance/);
    });
  });
});
