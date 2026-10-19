import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { BridgeManager } from '../../src/protocol/bridge-manager.js';
import { ResourceValidator } from '../../src/services/resource-validator.js';

describe('routing a game URL to a bridge', () => {
  it('creates one bridge and reuses it', () => {
    const fresh = new BridgeManager();

    const first = fresh.getBridgeForUrl('wss://game.maj-soul.com/1/');
    const second = fresh.getBridgeForUrl('wss://mahjongsoul.game.yo-star.com/');

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(fresh.getCurrentBridge()).toBe(first);
  });

  it.each([
    'https://example.com/',
    // A marker in the path, the query or a lookalike host must not route here.
    'https://example.com/?ref=majsoul',
    'wss://gateway.majsoul.example/game',
    'https://notmajsoul.com/',
  ])('does not hand a bridge to %s', (url) => {
    const fresh = new BridgeManager();

    expect(fresh.getBridgeForUrl(url)).toBeNull();
    expect(fresh.getCurrentBridge()).toBeNull();
  });

  it('keeps the current bridge when a non-majsoul URL arrives', () => {
    const fresh = new BridgeManager();
    const bridge = fresh.getBridgeForUrl('wss://game.maj-soul.com/1/');

    expect(fresh.getBridgeForUrl('https://example.com/')).toBeNull();
    expect(fresh.getCurrentBridge()).toBe(bridge);
  });

  it('does nothing on a hot reload before a bridge exists', () => {
    expect(() => new BridgeManager().hotReloadLiqi()).not.toThrow();
  });
});

describe('checking for model files', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'akagi-resources-'));

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('reports a models directory that holds a model', async () => {
    const root = join(sandbox, 'with-model');
    mkdirSync(join(root, 'models'), { recursive: true });
    writeFileSync(join(root, 'models', 'akagi4p.safetensors'), '');

    await expect(new ResourceValidator(root).validate()).resolves.toEqual({ models: true });
  });

  it('reports a models directory that holds no model', async () => {
    const root = join(sandbox, 'wrong-file');
    mkdirSync(join(root, 'models'), { recursive: true });
    writeFileSync(join(root, 'models', 'notes.txt'), '');

    await expect(new ResourceValidator(root).validate()).resolves.toEqual({ models: false });
  });

  it('reports a missing models directory instead of throwing', async () => {
    await expect(new ResourceValidator(join(sandbox, 'nothing-here')).validate()).resolves.toEqual({
      models: false,
    });
  });
});
