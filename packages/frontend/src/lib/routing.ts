/**
 * The dashboard and the HUD are the same renderer bundle, distinguished by the
 * hash the main process opens them with. A window keeps its hash for its whole
 * life, so it can be read without subscribing to navigation.
 */
export function isHudWindow(): boolean {
  return window.location.hash === '#/hud';
}
