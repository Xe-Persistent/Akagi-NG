import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { safeStorage } from 'electron';

import { createLogger } from '../../logging/index.js';
import { getProjectRoot } from '../../shared/paths.js';
import { isRecord } from '../../shared/utils.js';
import type { KeyInfo } from './types.js';

const logger = createLogger('SecretStore');

const FILE_NAME = 'secrets.json';
const KEY_NAME = 'online_api_key';

let cachedKey: string | null = null;

/** `config/secrets.json`, next to `settings.json`; only ciphertext lives here. */
export function secretsPath(): string {
  return join(getProjectRoot(), 'config', FILE_NAME);
}

/** DPAPI/Keychain/Secret Service, via Electron. */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * A stored secret, or `''`. A value that cannot be decrypted (another user's
 * profile, a wiped keychain) is treated as absent rather than crashing a game.
 */
export function readSecret(name: string): string {
  const encoded = readStore()[name];
  if (!encoded) return '';

  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch (error) {
    logger.error(`Failed to decrypt the stored secret "${name}":`, error);
    return '';
  }
}

/**
 * Store a secret encrypted. `''` clears it. Throws when the platform has no
 * secure backend, so the caller can say so instead of silently writing
 * plaintext.
 */
export function writeSecret(name: string, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    clearSecret(name);
    return;
  }
  if (!isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this system');
  }

  const store = readStore();
  store[name] = safeStorage.encryptString(trimmed).toString('base64');
  writeStore(store);
}

export function clearSecret(name: string): void {
  const store = readStore();
  if (!(name in store)) return;
  delete store[name];
  writeStore(store);
}

/** The stored key, or `''`, cached because it is read at every decision. */
export function readApiKey(): string {
  if (cachedKey !== null) return cachedKey;
  cachedKey = readSecret(KEY_NAME);
  return cachedKey;
}

export function writeApiKey(key: string): void {
  writeSecret(KEY_NAME, key);
  cachedKey = key.trim();
}

export function clearApiKey(): void {
  clearSecret(KEY_NAME);
  cachedKey = '';
}

/** What the renderer may see: whether a key exists and its last four characters. */
export function readKeyInfo(): KeyInfo {
  const key = readApiKey();
  return { configured: key.length > 0, last4: key.slice(-4) };
}

/** Tests only: forget the in-memory copy so the file is re-read. */
export function resetSecretCache(): void {
  cachedKey = null;
}

function readStore(): Record<string, string> {
  const path = secretsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(parsed)) return {};
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return Object.fromEntries(entries);
  } catch (error) {
    logger.error('Ignoring an unreadable secret store:', error);
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  const path = secretsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
}
