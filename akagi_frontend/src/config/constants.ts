/**
 * 全局常量配置
 */

// SSE 连接配置
export const SSE_MAX_BACKOFF_MS = 30_000;
export const SSE_INITIAL_BACKOFF_MS = 1000;
export const SSE_MAX_RETRIES = 10; // 最大重试次数

// 设置保存 debounce 延迟
export const SETTINGS_DEBOUNCE_MS = 1000;

// Toast 通知的显示时长 (ms)
export const TOAST_DURATION_SHORT = 3000;
export const TOAST_DURATION_DEFAULT = 5000;

// 启动延迟配置
export const APP_STARTUP_MIN_DELAY_MS = 1600; // 应用初始化最小等待时间
export const APP_SPLASH_DELAY_MS = 1200; // Splash 动画持续时间

// 打牌推荐内容尺寸 (逻辑尺寸)
export const STREAM_PLAYER_WIDTH = 1280;
export const STREAM_PLAYER_HEIGHT = 720;

// HUD 窗口尺寸限制
export const HUD_MIN_WIDTH = 320;
export const HUD_MIN_HEIGHT = 180;
export const HUD_MAX_WIDTH = 1280;
export const HUD_MAX_HEIGHT = 720;
