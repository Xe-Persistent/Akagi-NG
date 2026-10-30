import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

// Built output lives under dist/main/shared, so the project root is three levels up.
const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * The project root: the repo in development, the parent of `Resources` once
 * packaged, which is where `config`, `models` and friends live.
 */
export function getProjectRoot(): string {
  return !app.isPackaged ? resolve(moduleDir, '../../..') : join(process.resourcesPath, '..');
}

export function getAssetPath(...paths: string[]): string {
  return join(getProjectRoot(), ...paths);
}

export function getCertificatesDir(): string {
  return getAssetPath('ca');
}

export function getRendererPath(...paths: string[]): string {
  return join(moduleDir, '../../renderer', ...paths);
}

export function getPreloadPath(): string {
  return join(moduleDir, '../preload.cjs');
}

/**
 * The inference engine's native addon, when it ships outside the archive.
 *
 * A `.node` cannot be `dlopen`ed from inside an asar — Electron would have to
 * extract it to a temp file first — so the release copies it to
 * `resources/engine/` instead of unpacking it next to the archive. Dev builds
 * leave it beside its JavaScript wrapper, so this returns null and the loader
 * finds it on its own.
 */
export function getEngineNativePath(): string | null {
  if (!app.isPackaged) return null;

  const dir = join(process.resourcesPath, 'engine');
  try {
    const addon = readdirSync(dir).find((name) => name.endsWith('.node'));
    return addon ? join(dir, addon) : null;
  } catch {
    return null;
  }
}
