import type { BrowserWindow } from 'electron';

/** Whether a window is still alive and usable for IPC. */
export function isSafeWindow(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
}

/** Sends an IPC message to a window that may be on its way out. */
export function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  if (isSafeWindow(win) && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

/**
 * A decoded JSON object: what `JSON.parse` gives for a message rather than a
 * list or a scalar. Both arrays and null report `typeof === 'object'`, so the
 * exclusion is spelled out once here instead of at every call site.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
