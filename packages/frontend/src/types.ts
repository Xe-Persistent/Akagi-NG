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

export type EngineType = 'local' | 'null';

export interface FullRecommendationData {
  recommendations: Recommendation[];
  engine_type: EngineType;
}

export interface NotificationItem {
  level?: string;
  code: string;
  msg?: string;
}

export interface Settings {
  log_level: string;
  locale: string;
  game_url: string;
  majsoul_server: MajsoulServer;
  mitm: {
    enabled: boolean;
    host: string;
    port: number;
    upstream: string;
  };
  model_config: {
    model_4p: string;
    model_3p: string;
    temperature: number;
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

export type ConnectionErrorCode = 'config_error' | 'service_disconnected';

export interface ResourceStatus {
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}
