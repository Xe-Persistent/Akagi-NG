import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';
import type { Schema } from 'electron-store';
import Store from 'electron-store';

import { createLogger } from './logger.js';
import type { MajsoulServer } from './schema/platforms.js';
import { getGameUrl, MAJSOUL_SERVERS } from './schema/platforms.js';
import { getProjectRoot } from './utils.js';

const logger = createLogger('Settings');

const LEGACY_MODEL_NAMES: Record<string, string> = {
  'mortal.pth': 'akagi4p.safetensors',
  'mortal3p.pth': 'akagi3p.safetensors',
};

export interface MITMConfig {
  enabled: boolean;
  host: string;
  port: number;
  upstream: string;
}

export interface ModelConfig {
  temperature: number;
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

/**
 * Drops keys that are no longer in the schema (previously `platform`, `ot`,
 * Python-era `server`, ...) and remaps legacy Mortal model filenames, so that
 * electron-store's `additionalProperties: false` validation accepts config
 * files written by older versions.
 */
function migrateLegacyConfigFile(
  configDir: string,
  schemaProperties: Record<string, unknown> | undefined,
) {
  const configPath = join(configDir, 'settings.json');
  if (!existsSync(configPath)) return;

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    let changed = false;

    if (schemaProperties) {
      for (const key of Object.keys(raw)) {
        if (!(key in schemaProperties)) {
          delete raw[key];
          changed = true;
        }
      }
    }

    const modelConfig = raw.model_config as Record<string, unknown> | undefined;
    if (modelConfig) {
      for (const key of ['model_4p', 'model_3p']) {
        const value = modelConfig[key];
        if (typeof value === 'string' && value in LEGACY_MODEL_NAMES) {
          modelConfig[key] = LEGACY_MODEL_NAMES[value];
          changed = true;
        }
      }
    }

    if (changed) {
      writeFileSync(configPath, JSON.stringify(raw, null, '\t') + '\n');
      logger.info('Migrated legacy settings file to the current schema');
    }
  } catch (err) {
    logger.error('Failed to migrate legacy settings file:', err);
  }
}

function getDefaultSettings(): AppSettings {
  return {
    log_level: 'INFO',
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
      temperature: 0.3,
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
    migrateLegacyConfigFile(configDir, schemaOptions);

    try {
      this.store = this.createStore(configDir, schemaOptions);
    } catch (err) {
      // A config file that still fails validation (e.g. hand-edited) would
      // crash the app on boot; back it up and regenerate from defaults.
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

  public getSettings(): AppSettings {
    return this.store.store;
  }

  public updateSettings(updates: Partial<AppSettings>) {
    const current = this.store.store;
    const newSettings = { ...current, ...updates };

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
    return defaults;
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

export const settingsManager = new SettingsManager();
