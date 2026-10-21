/** Whether a window is still alive and usable for IPC. */
export function isSafeWindow(win: Electron.BrowserWindow | null): win is Electron.BrowserWindow {
  return !!win && !win.isDestroyed();
}

/** Sends an IPC message to a window that may be on its way out. */
export function safeSend(win: Electron.BrowserWindow | null, channel: string, ...args: unknown[]) {
  if (isSafeWindow(win) && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}
