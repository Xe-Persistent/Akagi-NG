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
