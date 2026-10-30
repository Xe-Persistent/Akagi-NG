/** What the renderer asks for when it opens the game window. */
export interface GameWindowOptions {
  url?: string;
  /** Route the page through our MITM proxy instead of the debugger API. */
  useMitm?: boolean;
}

/**
 * Why a launch produced no window. The renderer picks the wording, because only
 * it knows the user's language.
 */
export type GameLaunchFailure = 'proxy' | 'url';

export type GameLaunchResult = { ok: true } | { ok: false; reason: GameLaunchFailure };

/** Proxy failures: the window never reached the game because it had no route. */
const PROXY_ERROR_CODES = new Set(['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED']);

/**
 * What a failed navigation means for the caller.
 *
 * `null` means it did not fail at all: the window was closed under us, or the
 * page cancelled its own navigation, which is what a redirect does. Destroying
 * a window mid-navigation surfaces as `ERR_FAILED` rather than `ERR_ABORTED`,
 * so the window's own state is what separates the two.
 */
export function classifyLoadFailure(
  error: { code?: string; errno?: number },
  state: { closing: boolean; destroyed: boolean },
): GameLaunchFailure | null {
  if (state.closing || state.destroyed) return null;
  if (error.code === 'ERR_ABORTED' || error.errno === -3) return null;

  return error.code !== undefined && PROXY_ERROR_CODES.has(error.code) ? 'proxy' : 'url';
}
