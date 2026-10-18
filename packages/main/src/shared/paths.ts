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

export function getRendererPath(...paths: string[]): string {
  return join(moduleDir, '../../renderer', ...paths);
}

export function getPreloadPath(): string {
  return join(moduleDir, '../preload.cjs');
}
