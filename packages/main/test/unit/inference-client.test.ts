import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../../src/services/online/inference-client.js';
import {
  clampReactTimeout,
  InferenceClient,
  InferenceError,
  REACT_TIMEOUT_MAX_MS,
  REACT_TIMEOUT_MIN_MS,
} from '../../src/services/online/inference-client.js';

const KEY = 'ot_live_0123456789abcdef';

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers one scripted response and records what it was asked. */
function fetchOnce(body: unknown, status = 200) {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function client(fetch: FetchLike, overrides: { reactTimeoutMs?: number } = {}) {
  return new InferenceClient({
    apiKey: KEY,
    baseUrl: 'https://api.example.test/',
    reactTimeoutMs: overrides.reactTimeoutMs,
    fetch,
  });
}

function bodyOf(call: Recorded | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body));
}

function headersOf(call: Recorded | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>;
}

describe('the react timeout', () => {
  it('is clamped to the advertised budget', () => {
    expect(clampReactTimeout(0)).toBe(REACT_TIMEOUT_MIN_MS);
    expect(clampReactTimeout(10)).toBe(REACT_TIMEOUT_MIN_MS);
    expect(clampReactTimeout(9000)).toBe(REACT_TIMEOUT_MAX_MS);
    expect(clampReactTimeout(1500)).toBe(1500);
    expect(clampReactTimeout(Number.NaN)).toBe(REACT_TIMEOUT_MAX_MS);
  });
});

describe('the inference client', () => {
  it('posts the seat and the events to /v3/react with the key in a header', async () => {
    const { fetch, calls } = fetchOnce({
      reaction: { type: 'dahai', pai: '5s' },
      candidates: [{ action: 'dahai:5s', prob: 0.7 }],
      model: 'mjot-4p',
    });

    const response = await client(fetch).react('', 2, [{ type: 'start_game' }]);

    expect(calls[0]!.url).toBe('https://api.example.test/v3/react');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY}`);
    expect(bodyOf(calls[0])).toEqual({ player_id: 2, events: [{ type: 'start_game' }] });
    expect(response).toEqual({
      reaction: { type: 'dahai', pai: '5s' },
      candidates: [{ action: 'dahai:5s', prob: 0.7 }],
      model: 'mjot-4p',
    });
  });

  it('sends the model only when one was chosen', async () => {
    const { fetch, calls } = fetchOnce({ reaction: null, candidates: [], model: null });

    await client(fetch).react('   ', 0, []);
    await client(fetch).react('mjot-3p', 0, []);

    expect(bodyOf(calls[0])).not.toHaveProperty('model');
    expect(bodyOf(calls[1]).model).toBe('mjot-3p');
  });

  it('reads a null reaction as "no legal action", not as a failure', async () => {
    const { fetch } = fetchOnce({ reaction: null, candidates: [] });

    const response = await client(fetch).react('', 0, []);

    expect(response.reaction).toBeNull();
    expect(response.candidates).toEqual([]);
  });

  it('never follows a redirect, so the key cannot leak to another host', async () => {
    const { fetch, calls } = fetchOnce({});

    await client(fetch).react('', 0, []);

    expect(calls[0]!.init?.redirect).toBe('error');
  });

  it('reports the retry delay an HTTP error carries', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify({ detail: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      });

    const failure = await client(fetch)
      .react('', 0, [])
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InferenceError);
    expect((failure as InferenceError).status).toBe(429);
    expect((failure as InferenceError).retryAfterMs).toBe(2000);
  });

  it('redacts the key from an error the server echoes back', async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify({ detail: `bad key ${KEY}` }), { status: 401 });

    const failure = await client(fetch)
      .keyStatus()
      .catch((error: unknown) => error);

    expect((failure as InferenceError).message).not.toContain(KEY);
    expect((failure as InferenceError).message).toContain('HTTP 401');
  });

  it('turns an aborted request into a timeout', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });

    const failure = await client(fetch, { reactTimeoutMs: REACT_TIMEOUT_MIN_MS })
      .react('', 0, [])
      .catch((error: unknown) => error);

    expect((failure as InferenceError).kind).toBe('timeout');
  });

  it('turns a caller cancel into its own error kind', async () => {
    const controller = new AbortController();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });

    const pending = client(fetch)
      .react('', 0, [], controller.signal)
      .catch((error: unknown) => error);
    controller.abort();

    expect(((await pending) as InferenceError).kind).toBe('cancelled');
  });

  it('reads the plan out of /v3/key', async () => {
    const { fetch, calls } = fetchOnce({
      plan: 'pro',
      expires_at: '2026-01-01T00:00:00Z',
      usage_today: 12,
      rpd: 2000,
      rpm: 60,
      topk: 5,
    });

    const status = await client(fetch).keyStatus();

    expect(calls[0]!.url).toBe('https://api.example.test/v3/key');
    expect(status).toEqual({
      plan: 'pro',
      expiresAt: '2026-01-01T00:00:00Z',
      usageToday: 12,
      rpd: 2000,
      rpm: 60,
      topk: 5,
    });
  });

  it('drops model rows without an id', async () => {
    const { fetch } = fetchOnce({
      models: [
        { id: 'mjot-4p', game: '4p', desc: '4 player' },
        { game: '3p', desc: 'no id' },
        { id: 'mjot-3p', game: '3p' },
      ],
    });

    const models = await client(fetch).models();

    expect(models.map((model) => model.id)).toEqual(['mjot-4p', 'mjot-3p']);
  });

  it('checks the health endpoint without a key', async () => {
    const fetch = vi.fn<FetchLike>(
      async () =>
        new Response(
          JSON.stringify({ status: 'ok', queue_depth: { '4p': 1, '3p': 2 }, workers_alive: true }),
        ),
    );

    const health = await InferenceClient.health('https://api.example.test', fetch);

    expect(headersOf({ url: '', init: fetch.mock.calls[0]![1] })).not.toHaveProperty(
      'Authorization',
    );
    expect(health).toEqual({ status: 'ok', queueDepth: 3, workersAlive: true });
  });

  it('redeems a code without a key and can renew an existing one', async () => {
    const { fetch, calls } = fetchOnce({
      key: 'ot_live_new',
      key_last4: 'new',
      plan: 'pro',
      expires_at: '2026-01-01',
      extended: false,
    });

    const result = await client(fetch).redeem(' code-1 ', { email: 'a@b.c', renewKey: ' ot_old ' });

    expect(headersOf(calls[0])).not.toHaveProperty('Authorization');
    expect(bodyOf(calls[0])).toEqual({ code: 'code-1', email: 'a@b.c', renew_key: 'ot_old' });
    expect(result.key).toBe('ot_live_new');
  });

  it('opens a checkout only for a Creem link', async () => {
    const ok = fetchOnce({
      checkout_id: 'ch_1',
      checkout_url: 'https://checkout.creem.io/abc',
      claim_secret: 'claim',
    });

    const created = await client(ok.fetch).createCheckout('pro-30', true);
    expect(bodyOf(ok.calls[0])).toEqual({ product: 'pro-30', redeem: true });
    expect(created.checkoutId).toBe('ch_1');

    const evil = fetchOnce({
      checkout_id: 'ch_2',
      checkout_url: 'https://creem.io.example.com/steal',
      claim_secret: 'claim',
    });

    await expect(client(evil.fetch).createCheckout('pro-30', true)).rejects.toThrow(
      /not a Creem link/,
    );
  });

  it('omits redeem for a subscription, which rejects unknown fields', async () => {
    const { fetch, calls } = fetchOnce({
      checkout_id: 'ch_1',
      checkout_url: 'https://checkout.creem.io/abc',
      claim_secret: 'claim',
    });

    await client(fetch).createCheckout('pro-monthly', false);

    expect(bodyOf(calls[0])).toEqual({ product: 'pro-monthly' });
  });

  it('reads a checkout poll, including states it does not know', async () => {
    const ready = fetchOnce({
      status: 'ready',
      key: 'ot_live_new',
      plan: 'pro',
      days: 30,
      expires_at: '2026-01-01',
    });
    const readyResult = await client(ready.fetch).checkoutResult('ch_1', 'claim');
    expect(bodyOf(ready.calls[0])).toEqual({ checkout_id: 'ch_1', claim: 'claim' });
    expect(readyResult.status).toBe('ready');
    expect(readyResult.key).toBe('ot_live_new');

    const odd = fetchOnce({ status: 'delivered' });
    expect((await client(odd.fetch).checkoutResult('ch_1', 'claim')).status).toBe('delivered');

    const unknown = fetchOnce({ status: 'something-new' });
    expect((await client(unknown.fetch).checkoutResult('ch_1', 'claim')).status).toBe('unknown');
  });

  it('rejects an incomplete checkout response', async () => {
    const { fetch } = fetchOnce({ checkout_id: 'ch_1' });

    await expect(client(fetch).createCheckout('pro-30', true)).rejects.toThrow(/incomplete/);
  });

  it('rejects a body that is not JSON', async () => {
    const { fetch } = fetchOnce('<html>gateway</html>');

    const failure = await client(fetch)
      .keyStatus()
      .catch((error: unknown) => error);

    expect((failure as InferenceError).kind).toBe('invalid-response');
  });
});
