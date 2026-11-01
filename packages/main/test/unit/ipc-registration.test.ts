/**
 * The renderer reaches the main process only through channel names written as
 * string literals in `packages/frontend/src/api`. Nothing type-checks that
 * coupling: a renamed channel compiles on both sides and fails at runtime with
 * "No handler registered", and a channel no renderer calls is dead weight the
 * main process still carries.
 *
 * So this reads the renderer's own source and requires the two sets to be equal.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { registerIpcHandlers } from '../../src/app/ipc/index.js';
import type { UpdaterManager } from '../../src/app/updater.js';
import type { WindowManager } from '../../src/app/window-manager.js';
import type { MitmProxyManager } from '../../src/services/capture/mitm-proxy.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import { handledChannels, resetIpcListeners } from '../electron-stub.js';
import { useTempProjectRootForFile } from '../project-root.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const API_DIR = join(repoRoot, 'packages', 'frontend', 'src', 'api');

/**
 * Every channel the renderer invokes: the first string literal after each
 * `invoke`, which is how all of `api/*.ts` spells it.
 */
function rendererChannels(): string[] {
  const channels = new Set<string>();

  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(API_DIR, file), 'utf8');

    for (const match of source.matchAll(/\binvoke\b/g)) {
      const call = source.slice(match.index, match.index + 300);
      const literal = call.match(/['"]([a-zA-Z][\w:-]*)['"]/);
      if (literal?.[1]) channels.add(literal[1]);
    }
  }

  return [...channels].sort();
}

describe('the IPC channel surface', () => {
  useTempProjectRootForFile('akagi-ipc-contract');

  function registered(): string[] {
    resetIpcListeners();
    registerIpcHandlers(
      {
        syncGameWindowProxy: async () => {},
        toggleHudWindow: async () => {},
      } as unknown as WindowManager,
      { refreshInferenceSource: () => {} } as unknown as EngineService,
      { start: async () => {}, stop: async () => {} } as unknown as MitmProxyManager,
      { getAvailableVersion: () => null } as unknown as UpdaterManager,
    );
    return handledChannels().sort();
  }

  it('reads the channels it thinks it does', () => {
    // Guards the parser: a broken regex would make the comparison below pass
    // by comparing two empty lists.
    expect(rendererChannels()).toContain('settings:get');
    expect(rendererChannels().length).toBeGreaterThan(20);
  });

  it('answers every channel the renderer invokes', () => {
    const missing = rendererChannels().filter((channel) => !registered().includes(channel));

    expect(missing).toEqual([]);
  });

  it('registers nothing the renderer cannot reach', () => {
    const invoked = rendererChannels();
    const unreachable = registered().filter((channel) => !invoked.includes(channel));

    expect(unreachable).toEqual([]);
  });
});
