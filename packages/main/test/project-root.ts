/**
 * A throw-away project root, swapped in for the checkout so a test can let the
 * settings and secret stores write without touching the repository.
 *
 * The schema is copied in because the settings store validates against it at
 * construction, which makes it a real dependency of every test that touches the
 * store rather than something to mock.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { resetSecretCache } from '../src/services/online/secret-store.js';
import { testPaths } from './electron-stub.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const schema = readFileSync(join(repoRoot, 'assets', 'settings.schema.json'), 'utf8');

/** Creates the directory layout the app expects to find next to its binary. */
export function createTempProjectRoot(prefix = 'akagi-test'): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'assets', 'settings.schema.json'), schema);
  return dir;
}

/**
 * Points the app at a fresh temporary project root for every test, and back at
 * the checkout afterwards. Use this when nothing caches the root at first use.
 *
 * @returns the directory the current test is writing into.
 */
export function useTempProjectRoot(prefix?: string): () => string {
  let dir = '';

  beforeEach(() => {
    dir = createTempProjectRoot(prefix);
    testPaths.projectRoot = dir;
    resetSecretCache();
  });

  afterEach(() => {
    testPaths.projectRoot = repoRoot;
    resetSecretCache();
    rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
}

/**
 * One temporary project root for the whole file.
 *
 * The settings store is a singleton that resolves its directory at
 * construction, so a file that reaches `getSettingsManager()` cannot move the
 * root between tests: every later test would still be writing into the
 * directory the first one deleted.
 */
export function useTempProjectRootForFile(prefix?: string): () => string {
  let dir = '';

  beforeAll(() => {
    dir = createTempProjectRoot(prefix);
    testPaths.projectRoot = dir;
  });

  afterAll(() => {
    testPaths.projectRoot = repoRoot;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetSecretCache();
  });

  return () => dir;
}
