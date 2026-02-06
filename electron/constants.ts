/**
 * Electron 层中央常量库
 */

// 窗口默认尺寸
export const DASHBOARD_WINDOW_WIDTH = 1280;
export const DASHBOARD_WINDOW_HEIGHT = 800;
export const DASHBOARD_WINDOW_MIN_WIDTH = 800;
export const DASHBOARD_WINDOW_MIN_HEIGHT = 500;

export const GAME_WINDOW_WIDTH = 1280;
export const GAME_WINDOW_HEIGHT = 720;

export const HUD_WINDOW_WIDTH = 640;
export const HUD_WINDOW_HEIGHT = 360;
export const HUD_MIN_WIDTH = 320;
export const HUD_MIN_HEIGHT = 180;
export const HUD_MAX_WIDTH = 1280;
export const HUD_MAX_HEIGHT = 720;

// 后端启动检查配置
export const BACKEND_STARTUP_CHECK_RETRIES = 20;
export const BACKEND_STARTUP_CHECK_INTERVAL_MS = 500;
export const BACKEND_STARTUP_CHECK_TIMEOUT_MS = 1000;

// 后端关闭配置
export const BACKEND_SHUTDOWN_TIMEOUT_MS = 5000;
export const BACKEND_SHUTDOWN_API_TIMEOUT_MS = 1000;

// 开发环境配置
export const DEV_SERVER_URL = 'http://localhost:5173';
export const DEV_HUD_URL = `${DEV_SERVER_URL}/#/hud`;

// 资源状态检查超时
