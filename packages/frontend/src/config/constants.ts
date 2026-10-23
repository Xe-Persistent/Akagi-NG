export const SETTINGS_DEBOUNCE_MS = 1000;

export const TOAST_DURATION_SHORT = 1500;
export const TOAST_DURATION_DEFAULT = 3000;

/**
 * The splash: the torii grows for `ENTER_MS`, the finished screen rests for
 * `HOLD_MS`, then it dissolves onto the app over `EXIT_MS`. `App` times the
 * stages from these, `LaunchScreen` animates from the same values, and the
 * dashboard cross-fades in over `EXIT_MS` as well.
 */
export const APP_SPLASH_ENTER_MS = 1000;
export const APP_SPLASH_HOLD_MS = 500;
export const APP_SPLASH_EXIT_MS = 1000;

// Logical size of the recommendation panel; it is scaled to fit its wrapper.
export const STREAM_PLAYER_WIDTH = 1280;
export const STREAM_PLAYER_HEIGHT = 720;
