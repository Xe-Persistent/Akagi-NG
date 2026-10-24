/**
 * Which model answers, and how quickly the status says so. The online switch and
 * the stored key are two separate edits, both of which change the answer without
 * a new game: the badge has to follow them immediately, not at the next deal.
 *
 * One test file so the settings manager singleton is created once, against the
 * throw-away project root below.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import { engineStatus } from '../../src/services/engine-status.js';
import {
  clearApiKey,
  resetSecretCache,
  writeApiKey,
} from '../../src/services/online/secret-store.js';
import { getSettingsManager } from '../../src/services/settings-manager.js';
import { testPaths } from '../electron-stub.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const schema = readFileSync(join(repoRoot, 'assets', 'settings.schema.json'), 'utf8');

let workDir: string;

/** Keeps the settings and the secret store out of the checkout. */
function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'akagi-inference-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'assets', 'settings.schema.json'), schema);
  return dir;
}

describe('naming the model that answers', () => {
  beforeEach(() => {
    workDir = makeProjectRoot();
    testPaths.projectRoot = workDir;
    resetSecretCache();
  });

  afterEach(() => {
    testPaths.projectRoot = repoRoot;
    resetSecretCache();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('needs both the switch and a stored key, and follows either edit', () => {
    const engine = new EngineService();

    try {
      engine.clientConnected();
      expect(engineStatus.get().inference).toBe('local');

      const settings = getSettingsManager();
      settings.updateSettings({ ot: { ...settings.getSettings().ot, online: true } });
      engine.refreshInferenceSource();
      // The switch alone is not enough.
      expect(engineStatus.get().inference).toBe('local');

      writeApiKey('sk-test-key');
      engine.refreshInferenceSource();
      expect(engineStatus.get().inference).toBe('mjot');

      clearApiKey();
      engine.refreshInferenceSource();
      expect(engineStatus.get().inference).toBe('local');
    } finally {
      engine.stop();
    }
  });
});
