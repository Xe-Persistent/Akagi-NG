import { shell } from 'electron';

import { createLogger } from '../../logging/index.js';
import { isRecord } from '../../shared/utils.js';
import { InferenceClient, isCreemUrl } from './inference-client.js';
import { clearSecret, readSecret, writeApiKey, writeSecret } from './secret-store.js';
import type { CheckoutState } from './types.js';

const logger = createLogger('Online');

/** The secret the pending checkout is kept under, so a restart can resume it. */
const PENDING_SECRET = 'creem_pending_checkout';
/** A checkout older than this is abandoned; Creem sessions do not last longer. */
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * The products the service sells. `days` is null for the auto-renewing plans,
 * which is also what decides the `redeem` flag: a one-time purchase is redeemed
 * server-side into a key, a subscription only ever carries one.
 */
const CREEM_PRODUCTS = [
  { id: 'pro-30', days: 30 },
  { id: 'pro-90', days: 90 },
  { id: 'pro-monthly', days: null },
  { id: 'pro-yearly', days: null },
] as const;

interface PendingCheckout {
  checkoutId: string;
  claimSecret: string;
  product: string;
  startedAt: number;
}

/** What the purchase dialog shows while it polls. */
interface PurchaseStatus {
  status: CheckoutState;
  plan: string;
  expiresAt: string;
  days: number;
  /** True when this poll turned the purchase into a stored key. */
  stored: boolean;
  message?: string;
}

interface PurchaseManagerDeps {
  /** The fixed official endpoint, read at every call. */
  getBaseUrl: () => string;
  createClient?: (baseUrl: string) => InferenceClient;
  openExternal?: (url: string) => Promise<void>;
  now?: () => number;
}

/**
 * The Creem flow: **create → pay in the browser → poll**.
 *
 * The checkout id and its one-time claim secret are kept encrypted so a poll can
 * resume after a restart: the credential is only ever handed to whoever holds
 * that secret, and a closed app would otherwise lose a purchase the buyer paid
 * for. `redeem: true` on one-time products means the poll returns the key
 * itself, so no code stays unspent.
 */
export class PurchaseManager {
  private readonly getBaseUrl: () => string;
  private readonly createClient: (baseUrl: string) => InferenceClient;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly now: () => number;

  private pending: PendingCheckout | null = null;

  public constructor(deps: PurchaseManagerDeps) {
    this.getBaseUrl = deps.getBaseUrl;
    this.createClient =
      deps.createClient ?? ((baseUrl) => new InferenceClient({ apiKey: '', baseUrl }));
    this.openExternal = deps.openExternal ?? ((url) => shell.openExternal(url));
    this.now = deps.now ?? Date.now;
  }

  /** The product a checkout is in progress for, for labelling the dialog. */
  public get pendingProduct(): string | null {
    return this.loadPending()?.product ?? null;
  }

  /**
   * Create a checkout and hand the buyer to Creem. Not idempotent: every call
   * opens a new checkout, so a double submit charges twice and the second
   * checkout replaces the first.
   */
  public async start(product: string): Promise<{ checkoutUrl: string }> {
    const definition = CREEM_PRODUCTS.find((entry) => entry.id === product);
    if (!definition) throw new Error(`Unknown product: ${product}`);

    const client = this.createClient(this.getBaseUrl());
    const created = await client.createCheckout(definition.id, definition.days !== null);

    this.storePending({
      checkoutId: created.checkoutId,
      claimSecret: created.claimSecret,
      product: definition.id,
      startedAt: this.now(),
    });
    logger.info(`Creem checkout started for ${definition.id}`);

    if (!isCreemUrl(created.checkoutUrl)) {
      throw new Error('The checkout link is not a Creem address; it was not opened');
    }
    await this.openExternal(created.checkoutUrl);
    return { checkoutUrl: created.checkoutUrl };
  }

  /**
   * One poll. A purchase becomes `ready` once; the key is stored here and the
   * pending entry dropped, so polling again cannot spend the claim twice.
   */
  public async poll(): Promise<PurchaseStatus> {
    const pending = this.loadPending();
    if (!pending) {
      return { ...emptyStatus('unknown'), message: 'No purchase in progress' };
    }

    const client = this.createClient(this.getBaseUrl());
    const result = await client.checkoutResult(pending.checkoutId, pending.claimSecret);

    if (result.status !== 'ready') {
      if (result.status !== 'pending') this.clearPending();
      return {
        status: result.status,
        plan: result.plan,
        expiresAt: result.expiresAt,
        days: result.days,
        stored: false,
      };
    }

    // A one-time purchase created with `redeem: true` carries the key; an older
    // server ignoring the flag carries a code instead. Accept whichever arrives
    // rather than trusting the flag that was sent.
    let key = result.key;
    if (!key && result.code) {
      key = (await client.redeem(result.code)).key;
    }

    if (!key) {
      this.clearPending();
      return {
        status: result.status,
        plan: result.plan,
        expiresAt: result.expiresAt,
        days: result.days,
        stored: false,
        message: 'The purchase is complete but no key was returned; check your email',
      };
    }

    writeApiKey(key);
    this.clearPending();
    logger.info('Purchase complete. The API key is stored.');
    return {
      status: result.status,
      plan: result.plan,
      expiresAt: result.expiresAt,
      days: result.days,
      stored: true,
    };
  }

  /** Abandon the checkout in progress; the stored key is about to be cleared. */
  public cancel(): void {
    this.clearPending();
  }

  private loadPending(): PendingCheckout | null {
    if (this.pending) return this.pending;

    const raw = readSecret(PENDING_SECRET);
    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPendingCheckout(parsed)) {
        this.clearPending();
        return null;
      }
      if (this.now() - parsed.startedAt > PENDING_MAX_AGE_MS) {
        this.clearPending();
        return null;
      }
      // Rebuilt field by field so a stray key in the file never comes back out
      // of `storePending`.
      this.pending = {
        checkoutId: parsed.checkoutId,
        claimSecret: parsed.claimSecret,
        product: parsed.product,
        startedAt: parsed.startedAt,
      };
      return this.pending;
    } catch {
      this.clearPending();
      return null;
    }
  }

  private storePending(pending: PendingCheckout): void {
    this.pending = pending;
    writeSecret(PENDING_SECRET, JSON.stringify(pending));
  }

  private clearPending(): void {
    this.pending = null;
    clearSecret(PENDING_SECRET);
  }
}

function emptyStatus(status: CheckoutState): PurchaseStatus {
  return { status, plan: '', expiresAt: '', days: 0, stored: false };
}

/** A resumed checkout is only as trustworthy as every field it is rebuilt from. */
function isPendingCheckout(value: unknown): value is PendingCheckout {
  return (
    isRecord(value) &&
    typeof value.checkoutId === 'string' &&
    typeof value.claimSecret === 'string' &&
    typeof value.product === 'string' &&
    typeof value.startedAt === 'number'
  );
}
