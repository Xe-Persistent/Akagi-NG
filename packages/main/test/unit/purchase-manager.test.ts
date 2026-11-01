/**
 * The Creem flow: create → pay in the browser → poll.
 *
 * Two things here are contracts rather than implementation. A purchase is
 * non-idempotent, so a second `start` must not be mistaken for a retry; and the
 * claim secret is spent exactly once, so a poll that settles a purchase must
 * leave nothing behind for the next poll to spend again.
 *
 * The other half is the checkout the app can resume after a restart: the
 * encrypted payload is the only way back to a purchase, so it is only trusted
 * when every field survives the round trip. Anything else is dropped and
 * cleared, never half-restored.
 */
import { describe, expect, it } from 'vitest';

import type { InferenceClient } from '../../src/services/online/inference-client.js';
import { PurchaseManager } from '../../src/services/online/purchase-manager.js';
import { readApiKey, readSecret, writeSecret } from '../../src/services/online/secret-store.js';
import type {
  CheckoutCreated,
  CheckoutResult,
  RedeemResult,
} from '../../src/services/online/types.js';
import { useTempProjectRoot } from '../project-root.js';

const PENDING_SECRET = 'creem_pending_checkout';
const NOW = 1_700_000_000_000;
const CREEM_URL = 'https://checkout.creem.io/ch_1';

const CHECKOUT: CheckoutCreated = {
  checkoutId: 'ch_1',
  checkoutUrl: CREEM_URL,
  claimSecret: 'claim-1',
};

/** What the fake service answers, per endpoint. */
interface ServiceBehaviour {
  createCheckout?: CheckoutCreated | Error;
  checkoutResult?: CheckoutResult | Error;
  redeem?: RedeemResult | Error;
}

/**
 * A client that records what it was called with. `PurchaseManager` only ever
 * calls three methods, so a stand-in is more honest than a real client with a
 * stubbed `fetch`.
 */
function fakeClient(behaviour: ServiceBehaviour = {}) {
  const calls = {
    createCheckout: [] as [string, boolean][],
    checkoutResult: [] as [string, string][],
    redeem: [] as [string, { email?: string; renewKey?: string } | undefined][],
  };

  function answer<T>(value: T | Error | undefined, fallback: T): T {
    if (value instanceof Error) throw value;
    return value ?? fallback;
  }

  const client = {
    createCheckout: async (product: string, redeem: boolean) => {
      calls.createCheckout.push([product, redeem]);
      return answer(behaviour.createCheckout, CHECKOUT);
    },
    checkoutResult: async (checkoutId: string, claim: string) => {
      calls.checkoutResult.push([checkoutId, claim]);
      return answer(behaviour.checkoutResult, pendingResult());
    },
    redeem: async (code: string, options?: { email?: string; renewKey?: string }) => {
      calls.redeem.push([code, options]);
      return answer(behaviour.redeem, redeemedResult());
    },
  } as unknown as InferenceClient;

  return { client, calls };
}

function pendingResult(): CheckoutResult {
  return { status: 'pending', key: null, code: null, plan: 'pro', expiresAt: '', days: 30 };
}

function readyResult(patch: Partial<CheckoutResult> = {}): CheckoutResult {
  return {
    status: 'ready',
    key: 'sk-new',
    code: null,
    plan: 'pro',
    expiresAt: '2027-01-01',
    days: 30,
    ...patch,
  };
}

function redeemedResult(patch: Partial<RedeemResult> = {}): RedeemResult {
  return {
    key: 'sk-redeemed',
    keyLast4: 'emed',
    plan: 'pro',
    expiresAt: '2027-01-01',
    extended: false,
    ...patch,
  };
}

interface Harness {
  manager: PurchaseManager;
  calls: ReturnType<typeof fakeClient>['calls'];
  opened: string[];
}

function harness(behaviour: ServiceBehaviour = {}, openError?: Error): Harness {
  const { client, calls } = fakeClient(behaviour);
  const opened: string[] = [];

  const manager = new PurchaseManager({
    getBaseUrl: () => 'https://mjapi.test',
    createClient: () => client,
    openExternal: async (url) => {
      opened.push(url);
      if (openError) throw openError;
    },
    now: () => NOW,
  });

  return { manager, calls, opened };
}

const storedPending = () => readSecret(PENDING_SECRET);

describe('starting a checkout', () => {
  useTempProjectRoot('akagi-purchase');

  it('asks for a redeemable checkout on a one-time product', async () => {
    const { manager, calls, opened } = harness();

    await expect(manager.start('pro-30')).resolves.toEqual({ checkoutUrl: CREEM_URL });

    expect(calls.createCheckout).toEqual([['pro-30', true]]);
    expect(opened).toEqual([CREEM_URL]);
  });

  it('asks for a plain checkout on a subscription', async () => {
    const { manager, calls } = harness();

    await manager.start('pro-monthly');

    // `redeem: false` is the server default; sending it would be a 400.
    expect(calls.createCheckout).toEqual([['pro-monthly', false]]);
  });

  it('refuses a product the service does not sell', async () => {
    const { manager, calls, opened } = harness();

    await expect(manager.start('pro-9000')).rejects.toThrow('Unknown product: pro-9000');

    expect(calls.createCheckout).toEqual([]);
    expect(opened).toEqual([]);
    expect(storedPending()).toBe('');
  });

  it('remembers the checkout so a restart can collect it', async () => {
    const { manager } = harness();

    await manager.start('pro-90');

    expect(manager.pendingProduct).toBe('pro-90');
    expect(JSON.parse(storedPending())).toMatchObject({
      checkoutId: 'ch_1',
      claimSecret: 'claim-1',
      product: 'pro-90',
      startedAt: NOW,
    });
  });

  it('refuses to open a link that is not Creem', async () => {
    const { manager, opened } = harness({
      createCheckout: { ...CHECKOUT, checkoutUrl: 'https://evil.test/pay' },
    });

    await expect(manager.start('pro-30')).rejects.toThrow(/not a Creem address/);
    expect(opened).toEqual([]);
  });

  it('lets a second submit replace the first instead of hiding it', async () => {
    const { manager, calls } = harness({
      createCheckout: { checkoutId: 'ch_2', checkoutUrl: CREEM_URL, claimSecret: 'claim-2' },
    });

    await manager.start('pro-30');
    await manager.start('pro-30');

    // Two checkouts were created, so two charges are possible: the caller must
    // not treat a repeat as a retry.
    expect(calls.createCheckout).toHaveLength(2);
    expect(JSON.parse(storedPending())).toMatchObject({
      checkoutId: 'ch_2',
      claimSecret: 'claim-2',
    });
  });

  it('surfaces a failure from the service without leaving a checkout behind', async () => {
    const { manager } = harness({ createCheckout: new Error('service is down') });

    await expect(manager.start('pro-30')).rejects.toThrow('service is down');
    expect(manager.pendingProduct).toBeNull();
  });
});

describe('polling a checkout', () => {
  useTempProjectRoot('akagi-purchase');

  /** Puts the manager in the state it is in after a checkout was started. */
  async function started(behaviour: ServiceBehaviour): Promise<Harness> {
    const state = harness(behaviour);
    await state.manager.start('pro-30');
    return state;
  }

  it('says so when there is nothing to poll', async () => {
    const { manager, calls } = harness();

    await expect(manager.poll()).resolves.toEqual({
      status: 'unknown',
      plan: '',
      expiresAt: '',
      days: 0,
      stored: false,
      message: 'No purchase in progress',
    });
    expect(calls.checkoutResult).toEqual([]);
  });

  it('asks about the stored checkout with its claim secret', async () => {
    const { manager, calls } = await started({});

    await manager.poll();

    expect(calls.checkoutResult).toEqual([['ch_1', 'claim-1']]);
  });

  it('keeps waiting while the buyer has not paid', async () => {
    const { manager } = await started({ checkoutResult: pendingResult() });

    const status = await manager.poll();

    expect(status).toMatchObject({ status: 'pending', stored: false });
    expect(manager.pendingProduct).toBe('pro-30');
  });

  it('drops the checkout once the service ends it', async () => {
    const { manager } = await started({
      checkoutResult: { ...pendingResult(), status: 'refunded' },
    });

    const status = await manager.poll();

    expect(status).toMatchObject({ status: 'refunded', stored: false });
    expect(manager.pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('stores the key a redeemable purchase carries', async () => {
    const { manager, calls } = await started({ checkoutResult: readyResult() });

    const status = await manager.poll();

    expect(status).toMatchObject({ status: 'ready', plan: 'pro', days: 30, stored: true });
    expect(readApiKey()).toBe('sk-new');
    expect(calls.redeem).toEqual([]);
    expect(manager.pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('spends the claim exactly once', async () => {
    const { manager } = await started({ checkoutResult: readyResult() });

    await manager.poll();
    const again = await manager.poll();

    expect(again).toMatchObject({ status: 'unknown', message: 'No purchase in progress' });
    expect(readApiKey()).toBe('sk-new');
  });

  it('redeems a code from a server that ignored the redeem flag', async () => {
    const { manager, calls } = await started({
      checkoutResult: readyResult({ key: null, code: 'code-1' }),
      redeem: redeemedResult(),
    });

    const status = await manager.poll();

    expect(calls.redeem).toEqual([['code-1', undefined]]);
    expect(readApiKey()).toBe('sk-redeemed');
    expect(status).toMatchObject({ stored: true });
  });

  it('keeps the checkout when a redemption fails', async () => {
    const { manager } = await started({
      checkoutResult: readyResult({ key: null, code: 'code-1' }),
      redeem: new Error('code already used'),
    });

    await expect(manager.poll()).rejects.toThrow('code already used');
    // The claim was not spent by us, so the checkout stays resumable.
    expect(manager.pendingProduct).toBe('pro-30');
    expect(readApiKey()).toBe('');
  });

  it('tells the buyer to check their email when nothing was returned', async () => {
    const { manager } = await started({
      checkoutResult: readyResult({ key: null, code: null }),
    });

    const status = await manager.poll();

    expect(status).toMatchObject({ status: 'ready', stored: false });
    expect(status.message).toMatch(/check your email/);
    expect(manager.pendingProduct).toBeNull();
    expect(readApiKey()).toBe('');
  });
});

describe('cancelling a checkout', () => {
  useTempProjectRoot('akagi-purchase');

  it('forgets a checkout that was started', async () => {
    const { manager } = harness();
    await manager.start('pro-30');

    manager.cancel();

    expect(manager.pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('is harmless when nothing is in progress', () => {
    const { manager } = harness();

    expect(() => manager.cancel()).not.toThrow();
    expect(manager.pendingProduct).toBeNull();
  });
});

describe('resuming a stored checkout', () => {
  useTempProjectRoot('akagi-purchase');

  const manager = () =>
    new PurchaseManager({ getBaseUrl: () => 'https://mjapi.test', now: () => NOW });

  function store(pending: unknown): void {
    writeSecret(PENDING_SECRET, JSON.stringify(pending));
  }

  it('restores a checkout that is still fresh', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', product: 'pro-30', startedAt: NOW - 1000 });

    expect(manager().pendingProduct).toBe('pro-30');
    expect(storedPending()).not.toBe('');
  });

  it('drops a checkout older than the session window', () => {
    store({
      checkoutId: 'ch_1',
      claimSecret: 'claim',
      product: 'pro-30',
      startedAt: NOW - 7_200_000,
    });

    expect(manager().pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('drops a checkout that lost a field', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', startedAt: NOW });
    expect(storedPending()).not.toBe('');

    expect(manager().pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('drops a checkout whose field survived as the wrong type', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', product: 'pro-30', startedAt: 'now' });

    expect(manager().pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('drops a payload that is not an object at all', () => {
    store(['ch_1', 'claim', 'pro-30', NOW]);

    expect(manager().pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });

  it('has nothing to resume when no checkout was stored', () => {
    expect(manager().pendingProduct).toBeNull();
    expect(storedPending()).toBe('');
  });
});
