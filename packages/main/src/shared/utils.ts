/**
 * 判断一个窗口对象是否处于完全可用、可交互且未被销毁的状态
 */
export function isSafeWindow(win?: Electron.BrowserWindow | null): win is Electron.BrowserWindow {
  return !!win && !win.isDestroyed();
}

/**
 * 向一个可能处于边缘销毁状态的窗口发送 IPC 消息
 */
export function safeSend(
  win: Electron.BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
) {
  if (isSafeWindow(win) && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}
