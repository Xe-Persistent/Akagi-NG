import { TOAST_DURATION_DEFAULT, TOAST_DURATION_SHORT } from './constants';
import {
  STATUS_DOMAIN,
  STATUS_LEVEL,
  STATUS_LIFECYCLE,
  STATUS_PLACEMENT,
  type StatusDomain,
  type StatusLevel,
  type StatusPlacement,
} from './statusConstants';

export type { StatusDomain, StatusLevel, StatusPlacement };

type BaseStatusUIConfig = {
  level?: StatusLevel;
  placement?: StatusPlacement;
  domain?: StatusDomain;
  messageKey?: string;
};

type EphemeralConfig = BaseStatusUIConfig & {
  lifecycle: typeof STATUS_LIFECYCLE.EPHEMERAL;
  autoHide?: number; // 允许
  sticky?: false; // 默认false
};

type PersistentConfig = BaseStatusUIConfig & {
  lifecycle: typeof STATUS_LIFECYCLE.PERSISTENT;
  sticky?: never; // 禁止
  autoHide?: never; // 禁止
};

type ReplaceableConfig = BaseStatusUIConfig & {
  lifecycle: typeof STATUS_LIFECYCLE.REPLACEABLE;
  sticky?: true; // 默认true
  autoHide?: never; // 禁止
};

export type StatusUIConfig = EphemeralConfig | PersistentConfig | ReplaceableConfig;

export const STATUS_UI_MAP = {
  // JSON数据解析错误
  json_decode_error: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.RUNTIME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_DEFAULT,
  },

  // Bot 错误
  no_bot_loaded: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.MODEL,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  bot_switch_failed: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.MODEL,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_DEFAULT,
  },
  bot_runtime_error: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.RUNTIME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_DEFAULT,
  },
  state_tracker_error: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.RUNTIME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_DEFAULT,
  },

  // 模型加载失败
  model_load_failed: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.MODEL,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  // 配置文件错误
  config_error: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.RUNTIME,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  majsoul_proto_update_failed: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.GAME,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  // 服务断开连接
  service_disconnected: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.CONNECTION,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  max_retries_exceeded: {
    level: STATUS_LEVEL.ERROR,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.CONNECTION,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  // 警告
  riichi_simulation_failed: {
    level: STATUS_LEVEL.WARNING,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.GAME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  game_data_parse_failed: {
    level: STATUS_LEVEL.WARNING,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.RUNTIME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_DEFAULT,
  },
  fallback_used: {
    level: STATUS_LEVEL.WARNING,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.SERVICE,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },

  // 信息/成功
  client_connected: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.CONNECTION,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  game_connected: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.CONNECTION,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  online_service_restored: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.SERVICE,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  model_loaded_local: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.MODEL,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  model_loaded_online: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.MODEL,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  majsoul_proto_updated: {
    level: STATUS_LEVEL.SUCCESS,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.GAME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  online_service_reconnecting: {
    level: STATUS_LEVEL.INFO,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.SERVICE,
    lifecycle: STATUS_LIFECYCLE.PERSISTENT,
  },
  game_disconnected: {
    level: STATUS_LEVEL.INFO,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.CONNECTION,
    lifecycle: STATUS_LIFECYCLE.REPLACEABLE,
  },
  return_lobby: {
    level: STATUS_LEVEL.INFO,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.GAME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
  game_syncing: {
    level: STATUS_LEVEL.INFO,
    placement: STATUS_PLACEMENT.TOAST,
    domain: STATUS_DOMAIN.GAME,
    lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
    autoHide: TOAST_DURATION_SHORT,
  },
} satisfies Record<string, StatusUIConfig>;

export function getStatusConfig(code: string): StatusUIConfig {
  return (
    (STATUS_UI_MAP as Record<string, StatusUIConfig>)[code] || {
      level: STATUS_LEVEL.INFO,
      placement: STATUS_PLACEMENT.TOAST,
      domain: STATUS_DOMAIN.RUNTIME,
      lifecycle: STATUS_LIFECYCLE.EPHEMERAL,
      autoHide: TOAST_DURATION_DEFAULT,
    }
  );
}
