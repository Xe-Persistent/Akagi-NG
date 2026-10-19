/** Constants shared by the main process. */

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

export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5174';
export const DEV_HUD_URL = `${DEV_SERVER_URL}/#/hud`;

export const GITHUB_OWNER = 'Xe-Persistent';
export const GITHUB_REPO = 'Akagi-NG';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// ExitOverlay fades in over 500ms, plus a little slack before we quit for real.
export const EXIT_ANIMATION_DELAY_MS = 800;
