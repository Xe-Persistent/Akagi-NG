import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsManager } from '../../src/services/settings-manager.js';
import { getGameUrl, MAJSOUL_SERVERS } from '../../src/shared/schema/platforms.js';
import { testPaths } from '../electron-stub.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const schema = readFileSync(join(repoRoot, 'assets', 'settings.schema.json'), 'utf8');

let workDir: string;

/** A throw-away project root: the store writes into its `config/`. */
function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'akagi-settings-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'assets', 'settings.schema.json'), schema);
  return dir;
}

describe('the settings store', () => {
  beforeEach(() => {
    workDir = makeProjectRoot();
    testPaths.projectRoot = workDir;
  });

  afterEach(() => {
    testPaths.projectRoot = repoRoot;
    rmSync(workDir, { recursive: true, force: true });
  });

  it('starts from the defaults the schema defines', () => {
    const settings = new SettingsManager().getSettings();

    expect(settings).toMatchObject({
      log_level: 'info',
      majsoul_server: 'cn',
      mitm: { enabled: false, host: '127.0.0.1', port: 6789, upstream: '' },
      model_config: { model_4p: 'akagi4p.safetensors', model_3p: 'akagi3p.safetensors' },
    });
    expect(settings.game_url).toContain('maj-soul');
  });

  it('merges a partial patch instead of wiping the section', () => {
    const manager = new SettingsManager();

    manager.updateSettings({ mitm: { port: 1080 } as never });

    expect(manager.getSettings().mitm).toMatchObject({
      port: 1080,
      host: '127.0.0.1',
      enabled: false,
      upstream: '',
    });
  });

  it('follows a server change with the matching url', () => {
    const manager = new SettingsManager();

    manager.updateSettings({ majsoul_server: 'jp' });

    expect(manager.getSettings().game_url).toBe('https://game.mahjongsoul.com/');
    expect(manager.getSettings().game_url).not.toBe(getGameUrl(MAJSOUL_SERVERS.CN));
  });

  it('hands out a snapshot, so a caller cannot write through it', () => {
    const manager = new SettingsManager();
    const settings = manager.getSettings();

    settings.mitm.port = 1;

    expect(manager.getSettings().mitm.port).toBe(6789);
  });

  it('survives to the next instance', () => {
    new SettingsManager().updateSettings({ log_level: 'debug' });

    expect(new SettingsManager().getSettings().log_level).toBe('debug');
  });

  it('restores the defaults on reset', () => {
    const manager = new SettingsManager();
    manager.updateSettings({ log_level: 'debug', mitm: { port: 1080 } as never });

    const restored = manager.resetSettings();

    expect(restored.log_level).toBe('info');
    expect(manager.getSettings().mitm.port).toBe(6789);
  });

  it('backs up a file the schema rejects and rebuilds the defaults', () => {
    writeFileSync(join(workDir, 'config', 'settings.json'), '{"log_level":"nonsense"}');

    const settings = new SettingsManager().getSettings();

    expect(settings.log_level).toBe('info');
    expect(readFileSync(join(workDir, 'config', 'settings.json.bak'), 'utf8')).toContain(
      'nonsense',
    );
  });

  it('lists the model files the release ships', async () => {
    const manager = new SettingsManager();

    expect(await manager.getAvailableModels()).toEqual([]);
  });
});
