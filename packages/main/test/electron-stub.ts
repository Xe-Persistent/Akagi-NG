/**
 * Stand-in for `electron`, aliased in by `vitest.config.ts`. It covers what the
 * main-process modules touch at import time and records every broadcast, so a
 * test can assert on what the renderer would have received.
 *
 * The app reports itself as packaged with `process.resourcesPath` pointing at the
 * repository, which makes `getProjectRoot()` resolve to the checkout: that is
 * where `assets/` and `models/` actually live.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SentMessage {
  channel: string;
  payload: unknown;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Where `getProjectRoot()` should point. The checkout works for everything that
 * reads `assets/` or `models/`; a test that writes (the settings store) points it
 * at a temporary directory instead.
 */
export const testPaths = { projectRoot: repoRoot };

/** Everything the main process broadcast, oldest first. */
export const sentMessages: SentMessage[] = [];

/** Clears the broadcast record; call it from `beforeEach`. */
export function resetSentMessages() {
  sentMessages.length = 0;
}

/** The payloads sent on one channel, in order. */
export function messagesOn<T = unknown>(channel: string): T[] {
  return sentMessages.filter((m) => m.channel === channel).map((m) => m.payload as T);
}

// `getProjectRoot()` reads this when the app is packaged; Node types it as
// read-only and has no such property at all.
Object.defineProperty(process, 'resourcesPath', {
  get: () => join(testPaths.projectRoot, 'Resources'),
  configurable: true,
});

const fakeWebContents = {
  isDestroyed: () => false,
  send: (channel: string, payload: unknown) => sentMessages.push({ channel, payload }),
};

const fakeWindow = { isDestroyed: () => false, webContents: fakeWebContents };

export class BrowserWindow {
  static getAllWindows() {
    return [fakeWindow];
  }
}

export const app = {
  isPackaged: true,
  name: 'akagi-ng',
  getName: () => 'akagi-ng',
  getLocale: () => 'zh-CN',
  getVersion: () => '0.0.0-test',
  getPath: (name: string) => join(process.env.TEMP ?? process.cwd(), 'akagi-ng-test', name),
  getAppPath: () => repoRoot,
  isReady: () => true,
  requestSingleInstanceLock: () => true,
  on: () => {},
  once: () => {},
  off: () => {},
  whenReady: () => Promise.resolve(),
};

export const webContents = { getAllWebContents: () => [] };

export const ipcMain = {
  handle: () => {},
  on: () => {},
  off: () => {},
  removeListener: () => {},
};

export const shell = { openExternal: async () => {} };
export const dialog = { showErrorBox: () => {} };

/**
 * Stand-in for OS-backed credential storage: a reversible prefix instead of
 * DPAPI/Keychain, so the store's file format and round-trip can be tested.
 */
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`stub:${value}`, 'utf8'),
  decryptString: (value: Buffer) => {
    const text = value.toString('utf8');
    if (!text.startsWith('stub:')) throw new Error('not encrypted by this backend');
    return text.slice('stub:'.length);
  },
};
export const session = { defaultSession: {} };
export const net = {};
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) };
export const nativeTheme = { shouldUseDarkColors: false, on: () => {} };
export class Tray {}
export class Menu {}
export const nativeImage = { createFromPath: () => ({}) };

// Some dependencies (electron-store) import the whole module as a default export.
export default {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  webContents,
};
