import { existsSync, readFileSync, renameSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';
import type { Schema } from 'electron-store';
import Store from 'electron-store';

import { createLogger } from '../logging/index.js';
import { getProjectRoot } from '../shared/paths.js';
import type { MajsoulServer } from '../shared/schema/platforms.js';
import { getGameUrl, MAJSOUL_SERVERS } from '../shared/schema/platforms.js';

const logger = createLogger('Settings');

export interface MITMConfig {
  enabled: boolean;
  host: string;
  port: number;
  upstream: string;
}

export interface ModelConfig {
  model_4p: string;
  model_3p: string;
}

export interface AppSettings {
  log_level: string;
  locale: string;
  game_url: string;
  majsoul_server: MajsoulServer;
  mitm: MITMConfig;
  model_config: ModelConfig;
}

function detectSystemLocale(): string {
  const locale = app.getLocale();
  if (locale.startsWith('zh-CN')) return 'zh-CN';
  if (locale.startsWith('zh-TW') || locale.startsWith('zh-HK')) return 'zh-TW';
  if (locale.startsWith('ja')) return 'ja-JP';
  return 'en-US';
}

function getDefaultSettings(): AppSettings {
  return {
    log_level: 'info',
    locale: detectSystemLocale(),
    game_url: getGameUrl(MAJSOUL_SERVERS.CN),
    majsoul_server: MAJSOUL_SERVERS.CN,
    mitm: {
      enabled: false,
      host: '127.0.0.1',
      port: 6789,
      upstream: '',
    },
    model_config: {
      model_4p: 'akagi4p.safetensors',
      model_3p: 'akagi3p.safetensors',
    },
  };
}

export class SettingsManager {
  private store: Store<AppSettings>;

  constructor() {
    let schemaOptions: Record<string, unknown> | undefined;
    try {
      const schemaPath = join(getProjectRoot(), 'assets', 'settings.schema.json');
      const schemaRaw = readFileSync(schemaPath, 'utf-8');
      const schemaJson = JSON.parse(schemaRaw);
      if (schemaJson && schemaJson.properties) {
        schemaOptions = schemaJson.properties;
      }
    } catch (err) {
      logger.error('Failed to load settings.schema.json', err);
    }

    const configDir = join(getProjectRoot(), 'config');

    try {
      this.store = this.createStore(configDir, schemaOptions);
    } catch (err) {
      // An unreadable config (hand-edited, or written by another version)
      // would crash the app on boot; back it up and start from defaults.
      logger.error('Invalid settings file, regenerating from defaults:', err);
      const configPath = join(configDir, 'settings.json');
      if (existsSync(configPath)) {
        renameSync(configPath, `${configPath}.bak`);
      }
      this.store = this.createStore(configDir, schemaOptions);
    }
  }

  private createStore(
    configDir: string,
    schemaOptions: Record<string, unknown> | undefined,
  ): Store<AppSettings> {
    return new Store<AppSettings>({
      defaults: getDefaultSettings(),
      cwd: configDir,
      name: 'settings',
      schema: schemaOptions as Schema<AppSettings>,
    });
  }

  /** A snapshot, so a caller cannot mutate the store through the returned object. */
  public getSettings(): AppSettings {
    return structuredClone(this.store.store);
  }

  public updateSettings(updates: Partial<AppSettings>) {
    const current = this.store.store;
    const newSettings: AppSettings = {
      ...current,
      ...updates,
      // The nested objects are merged so a patch that only carries one field
      // cannot wipe the rest of that section.
      mitm: { ...current.mitm, ...updates.mitm },
      model_config: { ...current.model_config, ...updates.model_config },
    };

    if (updates.majsoul_server) {
      newSettings.game_url = getGameUrl(newSettings.majsoul_server);
    }

    this.store.store = newSettings;
    logger.info('Settings updated and saved to disk');
  }

  public resetSettings(): AppSettings {
    const defaults = getDefaultSettings();
    this.store.store = defaults;
    logger.info('Settings reset to defaults');
    return structuredClone(defaults);
  }

  public async getAvailableModels(): Promise<string[]> {
    try {
      const modelsDir = join(getProjectRoot(), 'models');
      const files = await readdir(modelsDir);
      return files.filter((f) => f.endsWith('.safetensors'));
    } catch (err) {
      logger.error('Failed to read models directory:', err);
      return [];
    }
  }
}

let instance: SettingsManager | null = null;

/**
 * The store is created on first use, which must happen once the app is ready:
 * the default locale comes from `app.getLocale()`, and on Windows that call is
 * only reliable after `ready`.
 */
export function getSettingsManager(): SettingsManager {
  instance ??= new SettingsManager();
  return instance;
}

/** Where the game window should send its traffic when it goes through our proxy. */
export function getMitmConfig(): { host: string; port: number } {
  const settings = getSettingsManager().getSettings();
  return {
    host: settings.mitm.host,
    port: settings.mitm.port,
  };
}
