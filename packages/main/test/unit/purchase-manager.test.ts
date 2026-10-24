/**
 * The checkout the app can resume after a restart: the encrypted payload is the
 * only way back to a purchase, so it is only trusted when every field survives
 * the round trip. Anything else is dropped and cleared, never half-restored.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PurchaseManager } from '../../src/services/online/purchase-manager.js';
import {
  readSecret,
  resetSecretCache,
  writeSecret,
} from '../../src/services/online/secret-store.js';
import { testPaths } from '../electron-stub.js';

const PENDING_SECRET = 'creem_pending_checkout';
const NOW = 1_700_000_000_000;
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

let workDir: string;

function manager(): PurchaseManager {
  return new PurchaseManager({
    getBaseUrl: () => 'https://mjapi.shinkuan.me',
    now: () => NOW,
  });
}

/** Whether the stored payload is still there after the manager read it. */
function stillStored(): boolean {
  return readSecret(PENDING_SECRET) !== '';
}

describe('resuming a stored checkout', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'akagi-purchase-'));
    mkdirSync(join(workDir, 'config'), { recursive: true });
    testPaths.projectRoot = workDir;
    resetSecretCache();
  });

  afterEach(() => {
    testPaths.projectRoot = repoRoot;
    resetSecretCache();
    rmSync(workDir, { recursive: true, force: true });
  });

  function store(pending: unknown): void {
    writeSecret(PENDING_SECRET, JSON.stringify(pending));
  }

  it('restores a checkout that is still fresh', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', product: 'pro-30', startedAt: NOW - 1000 });

    expect(manager().pendingProduct).toBe('pro-30');
    expect(stillStored()).toBe(true);
  });

  it('drops a checkout older than the session window', () => {
    store({
      checkoutId: 'ch_1',
      claimSecret: 'claim',
      product: 'pro-30',
      startedAt: NOW - 7_200_000,
    });

    expect(manager().pendingProduct).toBeNull();
    expect(stillStored()).toBe(false);
  });

  it('drops a checkout that lost a field', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', startedAt: NOW });
    expect(stillStored()).toBe(true);

    expect(manager().pendingProduct).toBeNull();
    expect(stillStored()).toBe(false);
  });

  it('drops a checkout whose field survived as the wrong type', () => {
    store({ checkoutId: 'ch_1', claimSecret: 'claim', product: 'pro-30', startedAt: 'now' });

    expect(manager().pendingProduct).toBeNull();
    expect(stillStored()).toBe(false);
  });

  it('drops a payload that is not an object at all', () => {
    store(['ch_1', 'claim', 'pro-30', NOW]);

    expect(manager().pendingProduct).toBeNull();
    expect(stillStored()).toBe(false);
  });

  it('has nothing to resume when no checkout was stored', () => {
    expect(manager().pendingProduct).toBeNull();
    expect(stillStored()).toBe(false);
  });
});
