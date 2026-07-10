import type { MajsoulServer, Platform } from '@/config/platforms';

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

export type EngineType = 'mortal' | 'akagiapi' | 'akagiot' | 'unknown' | 'null';

export interface ApiModelInfo {
  id: string;
  game: string;
  desc: string;
}

export interface ApiKeyStatus {
  plan: string;
  expires_at: string;
  usage_today: number;
  rpd: number;
  rpm: number;
  topk: number;
}

export interface ApiHealth {
  status: string;
  models: string[];
  queue_depth: Record<string, number>;
}

export interface ApiRedeemResponse {
  key?: string;
  key_last4: string;
  plan: string;
  expires_at: string;
  extended: boolean;
}

export interface FullRecommendationData {
  recommendations: Recommendation[];
  engine_type: EngineType;
  fallback_used: boolean;
  circuit_open: boolean;
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
  majsoul_server: MajsoulServer;
  platform: Platform;
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
  api: {
    enabled: boolean;
    base_url: string;
    key: string;
    model_4p: string;
    model_3p: string;
  };
  model_config: {
    model_4p: string;
    model_3p: string;
    temperature: number;
  };
}

export interface SaveSettingsResponse extends ApiResponse<Settings> {
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

export type SSEErrorCode = 'config_error' | 'service_disconnected';

export interface ResourceStatus {
  lib: boolean;
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}
