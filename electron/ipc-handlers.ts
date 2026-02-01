import { app, ipcMain, shell } from 'electron';

import type { BackendManager } from './backend-manager';
import type { WindowManager } from './window-manager';

export function registerIpcHandlers(windowManager: WindowManager, backendManager: BackendManager) {
  // Toggle HUD Window
  ipcMain.handle('toggle-hud', async (event, show: boolean) => {
    await windowManager.toggleHudWindow(show);
    return true;
  });

  // Start Game Window / Browser Mode
  ipcMain.handle(
    'start-game',
    async (_event, options: { url?: string; useMitm?: boolean; platform?: string }) => {
      await windowManager.createGameWindow(options);
      return true;
    },
  );

  // Request App Shutdown
  ipcMain.handle('request-shutdown', async () => {
    // Notify all windows to start exit animation
    windowManager.getMainWindow()?.webContents.send('exit-animation-start');
    windowManager.getGameWindow()?.webContents.send('exit-animation-start');

    // Wait for animation (1.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Force stop backend before quit if needed (though will-quit also handles it)
    backendManager.stop();

    app.quit();
    return true;
  });

  // Open external URL in system browser
  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
        return true;
      }
      console.warn(`[IPC] Blocked opening non-http URL: ${url}`);
      return false;
    } catch {
      console.error(`[IPC] Invalid URL for open-external: ${url}`);
      return false;
    }
  });

  // Minimize Window
  ipcMain.handle('minimize-window', () => {
    windowManager.getMainWindow()?.minimize();
    return true;
  });

  // Maximize / Restore Window
  ipcMain.handle('maximize-window', (_event, type?: 'dashboard' | 'game') => {
    const win = type === 'game' ? windowManager.getGameWindow() : windowManager.getMainWindow();
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return true;
  });

  // Check if window is maximized
  ipcMain.handle('is-window-maximized', () => {
    return windowManager.getMainWindow()?.isMaximized() || false;
  });

  // Example: Get current app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Check resource status (lib/models)
  ipcMain.handle('check-resource-status', async () => {
    return backendManager.getResourceStatus();
  });

  // Wait for backend to be ready (port 8765 bound)
  ipcMain.handle('wait-for-backend', async (_event, timeoutMs?: number) => {
    return await backendManager.waitForReady(timeoutMs);
  });
}
