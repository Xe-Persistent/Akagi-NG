import { isRecord } from '../../shared/utils.js';
import type {
  CheckoutCreated,
  CheckoutResult,
  CheckoutState,
  KeyStatus,
  ReactCandidate,
  ReactResponse,
  RedeemResult,
  RemoteModel,
  ServerHealth,
} from './types.js';

/** The only server this build talks to; the UI shows it read-only. */
export const DEFAULT_BASE_URL = 'https://mjapi.shinkuan.me';

/** `/v3/react` sits on a live turn, so its budget is bounded and adjustable. */
export const REACT_TIMEOUT_MIN_MS = 500;
export const REACT_TIMEOUT_MAX_MS = 3_000;
export const REACT_TIMEOUT_DEFAULT_MS = 3_000;
/** Management endpoints are called from the settings page and can wait. */
const MANAGEMENT_TIMEOUT_MS = 8_000;

/** `creem.io` or one of its subdomains; a checkout link goes nowhere else. */
const CREEM_HOST = 'creem.io';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type InferenceErrorKind = 'timeout' | 'cancelled' | 'network' | 'http' | 'invalid-response';

/** Every failure carries the facts the caller needs to decide whether to retry. */
export class InferenceError extends Error {
  public readonly kind: InferenceErrorKind;
  public readonly status: number | null;
  public readonly retryAfterMs: number | null;

  public constructor(
    kind: InferenceErrorKind,
    message: string,
    details: { status?: number | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'InferenceError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
  }
}

/** Clamp a user-supplied react budget; a stored `0` must not guarantee a miss. */
export function clampReactTimeout(ms: number): number {
  if (!Number.isFinite(ms)) return REACT_TIMEOUT_DEFAULT_MS;
  return Math.min(REACT_TIMEOUT_MAX_MS, Math.max(REACT_TIMEOUT_MIN_MS, Math.round(ms)));
}

/** A pasted key often carries a trailing newline, which turns into a 401. */
function sanitizeApiKey(value: string): string {
  return value.trim();
}

/** Trailing slashes would double up against the `/v3/...` paths. */
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

interface InferenceClientOptions {
  apiKey: string;
  baseUrl?: string;
  reactTimeoutMs?: number;
  /** Injected by tests; production uses the global `fetch`. */
  fetch?: FetchLike;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
  auth: boolean;
  timeoutMs: number;
  label: string;
  signal?: AbortSignal;
}

/**
 * Thin, typed client for the inference service. Holds one connection pool by
 * being constructed once per (server, key, timeout) tuple and reused.
 *
 * The key only ever travels in the `Authorization` header: never in a URL, a log
 * line, or an error message (the server may echo it back, so responses are
 * redacted before they become errors).
 */
export class InferenceClient {
  public readonly baseUrl: string;
  public readonly reactTimeoutMs: number;
  private readonly apiKey: string;
  private readonly doFetch: FetchLike;

  public constructor(options: InferenceClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = sanitizeApiKey(options.apiKey);
    this.reactTimeoutMs = clampReactTimeout(options.reactTimeoutMs ?? REACT_TIMEOUT_DEFAULT_MS);
    this.doFetch = options.fetch ?? fetch;
  }

  /** Host only, for logs: the key and the path have no diagnostic value there. */
  public get host(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return this.baseUrl;
    }
  }

  public get hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  /** `POST /v3/react` — the move for the final event of `events`. */
  public async react(
    model: string,
    playerId: number,
    events: unknown[],
    signal?: AbortSignal,
  ): Promise<ReactResponse> {
    const body: Record<string, unknown> = { player_id: playerId, events };
    const trimmed = model.trim();
    if (trimmed) body.model = trimmed;

    const payload = await this.request('/v3/react', {
      method: 'POST',
      body,
      auth: true,
      timeoutMs: this.reactTimeoutMs,
      label: 'react',
      signal,
    });

    return {
      reaction: isRecord(payload.reaction) ? payload.reaction : null,
      candidates: parseCandidates(payload.candidates),
      model: typeof payload.model === 'string' ? payload.model : null,
    };
  }

  /** `GET /v3/key` — plan, expiry and live limits. Also the key validation call. */
  public async keyStatus(): Promise<KeyStatus> {
    const payload = await this.request('/v3/key', {
      method: 'GET',
      auth: true,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'key status',
    });
    return {
      plan: text(payload.plan),
      expiresAt: text(payload.expires_at),
      usageToday: integer(payload.usage_today),
      rpd: integer(payload.rpd),
      rpm: number(payload.rpm),
      topk: integer(payload.topk),
    };
  }

  /** `GET /v3/models` — the models this key's plan may use. */
  public async models(): Promise<RemoteModel[]> {
    const payload = await this.request('/v3/models', {
      method: 'GET',
      auth: true,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'models',
    });
    const rows = Array.isArray(payload.models) ? payload.models : [];
    return rows.filter(isRecord).flatMap((row) => {
      const id = text(row.id);
      return id ? [{ id, game: text(row.game), description: text(row.desc) }] : [];
    });
  }

  /** `GET /healthz` — no authentication, so the key is never sent. */
  public static async health(
    baseUrl = DEFAULT_BASE_URL,
    doFetch: FetchLike = fetch,
  ): Promise<ServerHealth> {
    const client = new InferenceClient({ apiKey: '', baseUrl, fetch: doFetch });
    const payload = await client.request('/healthz', {
      method: 'GET',
      auth: false,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'health',
    });
    return {
      status: text(payload.status),
      queueDepth: queueDepthTotal(payload.queue_depth),
      workersAlive: payload.workers_alive !== false,
    };
  }

  /** `POST /v3/redeem` — exchanges a code for a key. Unauthenticated. */
  public async redeem(
    code: string,
    options: { email?: string; renewKey?: string } = {},
  ): Promise<RedeemResult> {
    const body: Record<string, unknown> = { code: code.trim() };
    const email = options.email?.trim();
    const renewKey = options.renewKey?.trim();
    if (email) body.email = email;
    if (renewKey) body.renew_key = renewKey;

    const payload = await this.request('/v3/redeem', {
      method: 'POST',
      body,
      auth: false,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'redeem',
    });

    return {
      key: typeof payload.key === 'string' && payload.key ? payload.key : null,
      keyLast4: text(payload.key_last4),
      plan: text(payload.plan),
      expiresAt: text(payload.expires_at),
      extended: payload.extended === true,
    };
  }

  /** `POST /creem/create-checkout` — one endpoint for both product kinds. */
  public async createCheckout(product: string, redeem: boolean): Promise<CheckoutCreated> {
    const body: Record<string, unknown> = { product: product.trim() };
    // The endpoint is shared with subscriptions, where an unexpected field is a
    // 400; `redeem: false` is the server default, so it is omitted entirely.
    if (redeem) body.redeem = true;

    const payload = await this.request('/creem/create-checkout', {
      method: 'POST',
      body,
      auth: false,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'checkout',
    });

    const checkoutId = text(payload.checkout_id);
    const checkoutUrl = text(payload.checkout_url);
    const claimSecret = text(payload.claim_secret);
    if (!checkoutId || !checkoutUrl || !claimSecret) {
      throw new InferenceError('invalid-response', 'checkout returned an incomplete response');
    }
    if (!isCreemUrl(checkoutUrl)) {
      throw new InferenceError('invalid-response', 'checkout URL is not a Creem link');
    }
    return { checkoutId, checkoutUrl, claimSecret };
  }

  /** `POST /creem/result` — poll a checkout; `ready` carries the key. */
  public async checkoutResult(checkoutId: string, claim: string): Promise<CheckoutResult> {
    const payload = await this.request('/creem/result', {
      method: 'POST',
      body: { checkout_id: checkoutId, claim },
      auth: false,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      label: 'checkout result',
    });

    return {
      status: checkoutState(payload.status),
      key: typeof payload.key === 'string' && payload.key ? payload.key : null,
      code: typeof payload.code === 'string' && payload.code ? payload.code : null,
      plan: text(payload.plan),
      expiresAt: text(payload.expires_at),
      days: integer(payload.days),
    };
  }

  private async request(path: string, options: RequestOptions): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.auth && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const signals: AbortSignal[] = [AbortSignal.timeout(options.timeoutMs)];
    if (options.signal) signals.push(options.signal);

    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        // A redirect must never carry the bearer header to another host.
        redirect: 'error',
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new InferenceError('cancelled', `${options.label} was cancelled`);
      }
      if (isAbortError(error)) {
        throw new InferenceError('timeout', `${options.label} timed out`);
      }
      throw new InferenceError('network', `${options.label} could not reach the server`);
    }

    const raw = await response.text();
    const payload = parseJsonObject(raw);

    if (!response.ok) {
      throw new InferenceError(
        'http',
        `${options.label} failed (HTTP ${response.status})${errorDetail(payload, raw, this.apiKey)}`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        },
      );
    }

    if (!payload) {
      throw new InferenceError('invalid-response', `${options.label} returned invalid JSON`);
    }
    return payload;
  }
}

// ===== Parsing helpers =====

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function integer(value: unknown): number {
  return Math.trunc(number(value));
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCandidates(value: unknown): ReactCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((row) => {
    const action = text(row.action);
    if (!action) return [];
    return [{ action, prob: Math.min(1, Math.max(0, number(row.prob))) }];
  });
}

/** Older servers answer with a per-model map; both shapes collapse to a total. */
function queueDepthTotal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>(
    (total, entry) => total + (typeof entry === 'number' ? entry : 0),
    0,
  );
}

const CHECKOUT_STATES: readonly CheckoutState[] = [
  'pending',
  'ready',
  'delivered',
  'refunded',
  'cancelled',
  'expired',
  'suspended',
];

function checkoutState(value: unknown): CheckoutState {
  const state = typeof value === 'string' ? value.toLowerCase() : '';
  return CHECKOUT_STATES.find((known) => known === state) ?? 'unknown';
}

/**
 * Only an `https` Creem link may be opened in the buyer's browser: the URL comes
 * back from the network, and opening anything else hands an attacker a
 * command-line or a lookalike phishing page.
 */
export function isCreemUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === CREEM_HOST || url.hostname.endsWith(`.${CREEM_HOST}`))
    );
  } catch {
    return false;
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date; both become millis. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function errorDetail(payload: Record<string, unknown> | null, raw: string, apiKey: string): string {
  const message =
    (payload && typeof payload.error === 'string' && payload.error) || raw.slice(0, 200);
  if (!message) return '';
  const safe = apiKey.length >= 8 ? message.split(apiKey).join(`***${apiKey.slice(-4)}`) : message;
  return `: ${safe}`;
}
