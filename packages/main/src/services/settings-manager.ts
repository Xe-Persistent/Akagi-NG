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
import {
  clampReactTimeout,
  DEFAULT_BASE_URL,
  REACT_TIMEOUT_DEFAULT_MS,
} from './online/inference-client.js';

const logger = createLogger('Settings');

export interface MITMConfig {
  enabled: boolean;
  port: number;
  upstream: string;
}

export interface ModelConfig {
  model_4p: string;
  model_3p: string;
}

/**
 * Online inference settings, named `ot` to stay compatible with v1.0.8 files.
 * The API key is deliberately absent: it lives encrypted in `secrets.json`.
 */
export interface OnlineSettings {
  online: boolean;
  /** Fixed official endpoint; shown read-only so a key cannot be sent elsewhere. */
  server: string;
  /** Model id per player count; empty lets the server pick its default. */
  model_4p: string;
  model_3p: string;
  /** `/v3/react` budget in milliseconds, clamped to 500–3000. */
  react_timeout_ms: number;
}

export interface AppSettings {
  log_level: string;
  locale: string;
  game_url: string;
  majsoul_server: MajsoulServer;
  mitm: MITMConfig;
  model_config: ModelConfig;
  ot: OnlineSettings;
}

/** Only the part of the JSON schema file that electron-store consumes. */
interface SettingsSchemaJson {
  properties?: Record<string, unknown>;
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
      port: 6789,
      upstream: '',
    },
    model_config: {
      model_4p: 'akagi4p.safetensors',
      model_3p: 'akagi3p.safetensors',
    },
    ot: {
      online: false,
      server: DEFAULT_BASE_URL,
      model_4p: '',
      model_3p: '',
      react_timeout_ms: REACT_TIMEOUT_DEFAULT_MS,
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
      const schemaJson = JSON.parse(schemaRaw) as SettingsSchemaJson;
      schemaOptions = schemaJson.properties;
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
      ot: {
        ...current.ot,
        ...updates.ot,
        // The endpoint is fixed, and the timeout must stay inside the budget
        // the UI advertises regardless of what a caller sends.
        server: DEFAULT_BASE_URL,
        react_timeout_ms: clampReactTimeout(
          updates.ot?.react_timeout_ms ?? current.ot.react_timeout_ms,
        ),
      },
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
    // The key is not one of the settings any more: it lives in the encrypted
    // store, the user cannot read it back to retype it, and losing a paid
    // credential to a "restore defaults" click is not recoverable. Clearing it
    // is the key card's own action.
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

/** Port the game window points its proxy at; the proxy is always addressed locally. */
export function getMitmPort(): number {
  return getSettingsManager().getSettings().mitm.port;
}
