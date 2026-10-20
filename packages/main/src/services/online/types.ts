/** Wire shapes of the online inference service (`/v3/*`, `/healthz`, `/creem/*`). */

/** One row of the server's top-k distribution. `action` is a coarse label. */
export interface ReactCandidate {
  action: string;
  prob: number;
}

/** `POST /v3/react`. `candidates[0]` corresponds to `reaction`. */
export interface ReactResponse {
  reaction: Record<string, unknown> | null;
  candidates: ReactCandidate[];
  model: string | null;
}

/** `GET /v3/key` — the key's plan, expiry and live limits. */
export interface KeyStatus {
  plan: string;
  expiresAt: string;
  usageToday: number;
  rpd: number;
  rpm: number;
  topk: number;
}

/** One row of `GET /v3/models`. */
export interface RemoteModel {
  id: string;
  game: string;
  description: string;
}

/** `GET /healthz` — liveness and aggregate load, no authentication. */
export interface ServerHealth {
  status: string;
  queueDepth: number;
  workersAlive: boolean;
}

/** `POST /v3/redeem` — `key` is present only when a new key was minted. */
export interface RedeemResult {
  key: string | null;
  keyLast4: string;
  plan: string;
  expiresAt: string;
  extended: boolean;
}

/**
 * What the renderer is told about a redemption. The key itself never leaves the
 * main process, so the one field that carries it is dropped here rather than
 * being blanked at every call site.
 */
export type RedeemOutcome = Omit<RedeemResult, 'key'>;

/** `POST /creem/create-checkout`. */
export interface CheckoutCreated {
  checkoutId: string;
  checkoutUrl: string;
  claimSecret: string;
}

/**
 * `pending` / `ready` as the service defines them, plus the terminal states a
 * paid order can end in. `delivered` is a closed retrieval window: the
 * credential was emailed instead of handed back here.
 */
export type CheckoutState =
  | 'pending'
  | 'ready'
  | 'delivered'
  | 'refunded'
  | 'cancelled'
  | 'expired'
  | 'suspended'
  | 'unknown';

/** `POST /creem/result` — reuses the order-result shape for both product kinds. */
export interface CheckoutResult {
  status: CheckoutState;
  key: string | null;
  code: string | null;
  plan: string;
  expiresAt: string;
  days: number;
}

/** The settings the decision path reads at every decision. */
export interface OnlineConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model4p: string;
  model3p: string;
  reactTimeoutMs: number;
}

/** Trimmed key state the renderer is allowed to see; never the key itself. */
export interface KeyInfo {
  configured: boolean;
  last4: string;
}
