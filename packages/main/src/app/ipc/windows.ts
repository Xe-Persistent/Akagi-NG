import { BrowserWindow, ipcMain } from 'electron';

import { isSafeWindow } from '../../shared/utils.js';
import type { WindowManager } from '../window-manager.js';
import type { GameWindowOptions } from '../windows/game-window.js';

/** Window controls and launching the game window. */
export function registerWindowHandlers(windowManager: WindowManager) {
  ipcMain.handle('toggle-hud', async (_event, show: boolean) => {
    await windowManager.toggleHudWindow(show);
    return true;
  });

  ipcMain.handle('start-game', async (_event, options: GameWindowOptions) => {
    await windowManager.createGameWindow(options);
    return true;
  });

  ipcMain.handle('minimize-window', () => {
    windowManager.getMainWindow()?.minimize();
    return true;
  });

  // Closing a window means hiding it: the app lives on in the tray.
  ipcMain.handle('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (isSafeWindow(win)) {
      win.close();
    }
    return true;
  });

  ipcMain.handle('maximize-window', (_event, type?: 'dashboard' | 'game') => {
    const win = type === 'game' ? windowManager.getGameWindow() : windowManager.getMainWindow();
    if (isSafeWindow(win)) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return true;
  });

  ipcMain.handle('is-window-maximized', () => {
    const win = windowManager.getMainWindow();
    return isSafeWindow(win) ? win.isMaximized() : false;
  });
}
