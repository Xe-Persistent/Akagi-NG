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

/**
 * The stopped screen: the renderer fades it in over `FADE_MS`, lets it rest for
 * `HOLD_MS`, then acknowledges. `SLACK_MS` is the fallback allowance for IPC
 * and paint if that acknowledgement never arrives.
 */
export const EXIT_ANIMATION_FADE_MS = 500;
export const EXIT_ANIMATION_HOLD_MS = 300;
export const EXIT_ANIMATION_SLACK_MS = 500;

/** Renderer → main: the stopped screen has finished its fade and hold. */
export const EXIT_ANIMATION_COMPLETE_CHANNEL = 'exit-animation-complete';
