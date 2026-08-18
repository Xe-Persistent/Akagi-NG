/**
 * 状态通知相关的常量定义
 */

export const STATUS_LEVEL = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const;

export type StatusLevel = (typeof STATUS_LEVEL)[keyof typeof STATUS_LEVEL];

export const STATUS_PLACEMENT = {
  STATUS: 'status',
  TOAST: 'toast',
} as const;

export type StatusPlacement = (typeof STATUS_PLACEMENT)[keyof typeof STATUS_PLACEMENT];

export const STATUS_DOMAIN = {
  CONNECTION: 'connection',
  MODEL: 'model',
  SERVICE: 'service',
  RUNTIME: 'runtime',
  GAME: 'game',
} as const;

export type StatusDomain = (typeof STATUS_DOMAIN)[keyof typeof STATUS_DOMAIN];

export const STATUS_LIFECYCLE = {
  EPHEMERAL: 'ephemeral',
  PERSISTENT: 'persistent',
  REPLACEABLE: 'replaceable',
} as const;

export type StatusLifecycle = (typeof STATUS_LIFECYCLE)[keyof typeof STATUS_LIFECYCLE];
