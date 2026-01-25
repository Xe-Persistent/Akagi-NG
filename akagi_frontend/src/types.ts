export interface Recommendation {
  action: string;
  confidence: number;
  consumed?: string[];
  tile?: string;
}

export interface NotificationItem {
  level: string;
  code: string;
  msg?: string;
}

export interface FullRecommendationData {
  recommendations: Recommendation[];
  is_riichi?: boolean;
}

export interface ApiResponse<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface Settings {
  log_level: string;
  locale: string;
  browser: {
    enabled: boolean;
    platform: string;
    url: string;
    headless: boolean;
    window_size: string;
  };
  mitm: {
    enabled: boolean;
    platform: string;
    host: string;
    port: number;
    upstream: string;
  };
  server: {
    host: string;
    port: number;
  };
  model_config: {
    device: string;
    temperature: number;
    enable_amp: boolean;
    enable_quick_eval: boolean;
    rule_based_agari_guard: boolean;
    ot: {
      online: boolean;
      server: string;
      api_key: string;
    };
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
  | 'reconnecting'
  | 'config_error'
  | 'service_disconnected';
