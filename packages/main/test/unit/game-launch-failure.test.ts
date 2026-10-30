/**
 * Telling a failed launch apart from a cancelled one. The user closing the
 * window they just opened arrives as `ERR_FAILED`, the same code a broken URL
 * produces, so only the window's own state can separate them — and getting it
 * wrong pops "check your settings" at someone who did nothing wrong.
 */
import { describe, expect, it } from 'vitest';

import { classifyLoadFailure } from '../../src/app/windows/game-launch.js';

const open = { closing: false, destroyed: false };

describe('classifying a failed game navigation', () => {
  it('treats a window the user closed as no failure at all', () => {
    expect(
      classifyLoadFailure({ code: 'ERR_FAILED', errno: -2 }, { closing: true, destroyed: true }),
    ).toBeNull();
  });

  it('treats a window that is already gone as no failure at all', () => {
    expect(
      classifyLoadFailure({ code: 'ERR_FAILED', errno: -2 }, { closing: false, destroyed: true }),
    ).toBeNull();
  });

  it('treats a cancelled navigation as no failure at all', () => {
    expect(classifyLoadFailure({ code: 'ERR_ABORTED', errno: -3 }, open)).toBeNull();
    expect(classifyLoadFailure({ errno: -3 }, open)).toBeNull();
  });

  it('blames the proxy when the window could not reach it', () => {
    expect(classifyLoadFailure({ code: 'ERR_PROXY_CONNECTION_FAILED' }, open)).toBe('proxy');
    expect(classifyLoadFailure({ code: 'ERR_TUNNEL_CONNECTION_FAILED' }, open)).toBe('proxy');
  });

  it('blames the URL for anything else', () => {
    expect(classifyLoadFailure({ code: 'ERR_NAME_NOT_RESOLVED' }, open)).toBe('url');
    expect(classifyLoadFailure({ code: 'ERR_FAILED' }, open)).toBe('url');
    expect(classifyLoadFailure({}, open)).toBe('url');
  });
});
