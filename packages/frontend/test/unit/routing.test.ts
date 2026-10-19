import { afterEach, describe, expect, it, vi } from 'vitest';

import { isHudWindow } from '@/lib/routing';

/** The dashboard and the HUD differ only by the hash the window was opened with. */
function withHash(hash: string) {
  vi.stubGlobal('window', { location: { hash } });
}

describe('telling the HUD window from the dashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognises the HUD route', () => {
    withHash('#/hud');

    expect(isHudWindow()).toBe(true);
  });

  it('treats the dashboard route as the dashboard', () => {
    withHash('#/');

    expect(isHudWindow()).toBe(false);
  });

  it('does not match a hash that only contains the word', () => {
    withHash('#/hud-settings');

    expect(isHudWindow()).toBe(false);
  });

  it('handles a window with no hash at all', () => {
    withHash('');

    expect(isHudWindow()).toBe(false);
  });
});
