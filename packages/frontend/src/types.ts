import type { MajsoulServer } from '@/config/platforms';

export interface SimCandidate {
  tile: string;
  confidence: number;
}

export interface Recommendation {
  action: string;
  confidence: number;
  consumed?: string[];
  sim_candidates?: SimCandidate[];
  tile?: string;
}

/** The payload of an `engine:recommendations` broadcast. */
export interface RecommendationData {
  recommendations: Recommendation[];
  /** Which engine produced these rows. */
  engine_type: 'mjot' | 'local';
  /** A configured online service failed and the local model answered instead. */
  fallback_used: boolean;
  /** The circuit breaker is holding online calls back. */
  circuit_open: boolean;
  /** Model id the server reported for an online decision. */
  model?: string;
}

/** Whether a game client websocket is currently open. */
export type ConnectionState = 'idle' | 'connected';

/** Whether the inference engine has usable weights. */
export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Things that happened once and leave no state behind. The sequence number lets
 * the renderer tell a repeat from the still-visible previous occurrence.
 */
export interface EngineNotice {
  kind: 'parse_error' | 'runtime_error' | 'replay' | 'lobby_return' | 'game_dropped';
  seq: number;
}

/** The engine's state as the main process reports it. */
export interface EngineStatus {
  connection: ConnectionState;
  model: ModelState;
  modelName: string | null;
  notice: EngineNotice | null;
}

export interface Settings {
  log_level: string;
  locale: string;
  game_url: string;
  majsoul_server: MajsoulServer;
  mitm: {
    enabled: boolean;
    port: number;
    upstream: string;
  };
  model_config: {
    model_4p: string;
    model_3p: string;
  };
  ot: {
    online: boolean;
    server: string;
    model_4p: string;
    model_3p: string;
    react_timeout_ms: number;
  };
}

/**
 * Every online IPC answers with the same envelope: a failure is shown in the
 * settings page, so a rejection never reaches an unhandled boundary.
 */
export interface OnlineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** What the renderer may know about the stored key: no key material. */
export interface OnlineKeyInfo {
  configured: boolean;
  last4: string;
}

/** `GET /v3/key` — the plan and the live limits it carries. */
export interface OnlineKeyStatus {
  plan: string;
  expiresAt: string;
  usageToday: number;
  rpd: number;
  rpm: number;
  topk: number;
}

/** `GET /v3/models` — `game` is `4p` or `3p`. */
export interface OnlineModel {
  id: string;
  game: string;
  description: string;
}

/** `GET /healthz` — no authentication, so it works before a key is entered. */
export interface OnlineHealth {
  status: string;
  queueDepth: number;
  workersAlive: boolean;
}

export interface OnlineRedeemResult {
  keyLast4: string;
  plan: string;
  expiresAt: string;
  extended: boolean;
}

/** One poll of a Creem checkout while the buyer pays in the browser. */
export interface OnlinePurchaseStatus {
  status:
    | 'pending'
    | 'ready'
    | 'delivered'
    | 'refunded'
    | 'cancelled'
    | 'expired'
    | 'suspended'
    | 'unknown';
  plan: string;
  expiresAt: string;
  days: number;
  stored: boolean;
  message?: string;
}

type Primitive = string | number | boolean | null | undefined | symbol | bigint;

export type Paths<T> = {
  [K in keyof T]: T[K] extends Primitive
    ? [K]
    : T[K] extends object
      ? [K] | [K, ...Paths<T[K]>]
      : [K];
}[keyof T];

export type PathValue<T, P extends readonly unknown[]> = P extends [infer K]
  ? K extends keyof T
    ? T[K]
    : never
  : P extends [infer K, ...infer R]
    ? K extends keyof T
      ? PathValue<T[K], R>
      : never
    : never;

export type Theme = 'light' | 'dark' | 'system';

export interface ResourceStatus {
  /** Whether at least one loadable model file is present. */
  models: boolean;
}
