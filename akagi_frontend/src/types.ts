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

export type EngineType = 'mortal' | 'akagiot' | 'unknown' | 'null';

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
  };
}

export interface MajsoulModSavedView {
  slot?: number;
  item_id?: number;
  itemId?: number;
  type?: number;
  item_id_list?: number[];
  itemIdList?: number[];
}

export interface MajsoulRandomCharacterEntry {
  character_id: number;
  skin_id: number;
}

export interface MajsoulModSettings {
  enabled: boolean;
  config: {
    character: number;
    characters: Record<string, number>;
    nickname: string;
    star_chars: number[];
    bianjietishi: boolean;
    title: number;
    loading_image: number[];
    emoji: boolean;
    views: Record<string, MajsoulModSavedView[]>;
    views_index: number;
    show_server: boolean;
    verified: number;
    anti_replace_nickname: boolean;
    random_character: {
      enabled: boolean;
      pool: MajsoulRandomCharacterEntry[];
    };
    safe_mode: boolean;
  };
  resource: {
    auto_update: boolean;
    lqc_lqbin_version: string;
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
