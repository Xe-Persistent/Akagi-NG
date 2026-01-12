export type StatusDomain = 'connection' | 'model' | 'service' | 'runtime' | 'game';
export type StatusLevel = 'info' | 'success' | 'warning' | 'error';
export type StatusPlacement = 'status' | 'toast';

type BaseStatusUIConfig = {
  level?: StatusLevel;
  placement?: StatusPlacement;
  domain?: StatusDomain;
  messageKey?: string;
};

type EphemeralConfig = BaseStatusUIConfig & {
  lifecycle: 'ephemeral';
  autoHide?: number; // 允许
  sticky?: false; // 默认false
};

type PersistentConfig = BaseStatusUIConfig & {
  lifecycle: 'persistent';
  sticky?: never; // 禁止
  autoHide?: never; // 禁止
};

type ReplaceableConfig = BaseStatusUIConfig & {
  lifecycle: 'replaceable';
  sticky?: true; // 默认true
  autoHide?: never; // 禁止
};

export type StatusUIConfig = EphemeralConfig | PersistentConfig | ReplaceableConfig;

export const STATUS_UI_MAP: Record<string, StatusUIConfig> = {
  // 系统缺失资源错误
  missing_resources: {
    level: 'error',
    placement: 'status',
    domain: 'runtime',
    lifecycle: 'persistent',
  },

  // JSON数据解析错误
  json_decode_error: {
    level: 'error',
    placement: 'toast',
    domain: 'runtime',
    lifecycle: 'ephemeral',
    autoHide: 5000,
  },

  // Bot 错误
  no_bot_loaded: {
    level: 'error',
    placement: 'status',
    domain: 'model',
    lifecycle: 'persistent',
  },
  bot_switch_failed: {
    level: 'error',
    placement: 'toast',
    domain: 'model',
    lifecycle: 'ephemeral',
    autoHide: 5000,
  },
  bot_runtime_error: {
    level: 'error',
    placement: 'toast',
    domain: 'runtime',
    lifecycle: 'ephemeral',
    autoHide: 5000,
  },
  state_tracker_error: {
    level: 'error',
    placement: 'toast',
    domain: 'runtime',
    lifecycle: 'ephemeral',
    autoHide: 5000,
  },

  // 模型加载失败
  model_load_failed: {
    level: 'error',
    placement: 'toast',
    domain: 'model',
    lifecycle: 'persistent',
  },
  // 配置文件错误
  config_error: {
    level: 'error',
    placement: 'status',
    domain: 'connection',
    lifecycle: 'persistent',
  },
  // 服务断开连接
  service_disconnected: {
    level: 'error',
    placement: 'status',
    domain: 'connection',
    lifecycle: 'persistent',
  },

  // 警告
  riichi_simulation_failed: {
    level: 'warning',
    placement: 'toast',
    domain: 'model',
    lifecycle: 'ephemeral',
    autoHide: 3000,
  },
  game_data_parse_failed: {
    level: 'warning',
    placement: 'toast',
    domain: 'runtime',
    lifecycle: 'ephemeral',
    autoHide: 5000,
  },
  fallback_used: {
    level: 'warning',
    placement: 'status',
    domain: 'service',
    lifecycle: 'persistent',
  },

  // 信息/成功
  game_connected: {
    level: 'success',
    placement: 'toast',
    domain: 'connection',
    lifecycle: 'replaceable',
  },
  reconnecting: {
    level: 'info',
    placement: 'status',
    domain: 'service',
    lifecycle: 'persistent',
  },
  online_service_restored: {
    level: 'success',
    placement: 'toast',
    domain: 'service',
    lifecycle: 'ephemeral',
    autoHide: 3000,
  },
  game_disconnected: {
    level: 'info',
    placement: 'toast',
    domain: 'connection',
    lifecycle: 'ephemeral',
    autoHide: 2000,
  },
  return_lobby: {
    level: 'info',
    placement: 'toast',
    domain: 'runtime',
    lifecycle: 'ephemeral',
    autoHide: 3000,
  },
  game_syncing: {
    level: 'info',
    placement: 'toast',
    domain: 'game',
    lifecycle: 'ephemeral',
    autoHide: 3000,
  },
};

export function getStatusConfig(code: string): StatusUIConfig {
  return (
    STATUS_UI_MAP[code] || {
      level: 'info',
      placement: 'toast',
      domain: 'runtime',
      lifecycle: 'ephemeral',
      autoHide: 4000,
    }
  );
}
