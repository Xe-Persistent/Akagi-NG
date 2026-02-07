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

export interface FullRecommendationData {
  recommendations: Recommendation[];
  engine_type?: string;
  is_fallback?: boolean;
  circuit_open?: boolean;
}

export interface NotificationItem {
  level?: string;
  code: string;
  msg?: string;
}

export interface ApiResponse<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface Settings {
  log_level: string;
  locale: string;
  game_url: string;
  platform: string;
  mitm: {
    enabled: boolean;
    host: string;
    port: number;
    upstream: string;
  };
  server: {
    host: string;
    port: number;
  };
  ot: {
    online: boolean;
    server: string;
    api_key: string;
  };
  model_config: {
    model_4p: string;
    model_3p: string;
    temperature: number;
    rule_based_agari_guard: boolean;
  };
}

export interface SaveSettingsResponse extends ApiResponse {
  restartRequired?: boolean;
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

export type SSEErrorCode =
  | 'max_retries_exceeded'
  | 'online_service_reconnecting'
  | 'config_error'
  | 'service_disconnected';

export interface ResourceStatus {
  lib: boolean;
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}
