import { app, BrowserWindow, ipcMain, shell } from 'electron';

import type { BackendManager } from './backend-manager.js';
import { EXIT_ANIMATION_DELAY_MS } from './constants.js';
import { createLogger } from './logger.js';
import type { MitmProxyManager } from './mitm-proxy.js';
import type { AppSettings } from './settings-manager.js';
import { settingsManager } from './settings-manager.js';
import { isSafeWindow, safeSend } from './utils.js';
import type { WindowManager } from './window-manager.js';

const logger = createLogger('IPC');

export function registerIpcHandlers(
  windowManager: WindowManager,
  backendManager: BackendManager,
  mitmProxyManager: MitmProxyManager,
) {
  // Toggle HUD Window
  ipcMain.handle('toggle-hud', async (_event, show: boolean) => {
    await windowManager.toggleHudWindow(show);
    return true;
  });

  // Settings Handlers
  ipcMain.handle('settings:get', () => {
    return settingsManager.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    try {
      settingsManager.updateSettings(updates);

      // If MITM settings changed, restart the proxy
      if (updates.mitm) {
        await mitmProxyManager.stop();
        if (updates.mitm.enabled) {
          await mitmProxyManager.start();
        }
      }

      return { success: true };
    } catch (err: unknown) {
      logger.error('Failed to update settings:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('settings:reset', () => {
    return settingsManager.resetSettings();
  });

  ipcMain.handle('settings:get-models', async () => {
    return await settingsManager.getAvailableModels();
  });

  // Start Game Window / Browser Mode
  ipcMain.handle('start-game', async (_event, options: { url?: string; useMitm?: boolean }) => {
    await windowManager.createGameWindow(options);
    return true;
  });

  // Request App Shutdown
  ipcMain.handle('request-shutdown', async () => {
    // Notify all windows to start exit animation
    safeSend(windowManager.getMainWindow(), 'exit-animation-start');
    safeSend(windowManager.getGameWindow(), 'exit-animation-start');

    // Run exit animation and backend shutdown in parallel
    await Promise.all([
      new Promise((resolve) => setTimeout(resolve, EXIT_ANIMATION_DELAY_MS)),
      backendManager.stop().catch((err: unknown) => logger.error('Backend stop error:', err)),
    ]);

    app.quit();
    return true;
  });

  // Protocol Update
  ipcMain.handle('update-liqi', async () => {
    try {
      logger.info('Starting update of liqi.json from majsoul server...');
      // Get version
      const verRes = await fetch('https://game.maj-soul.com/1/version.json');
      if (!verRes.ok) throw new Error(`Failed to fetch version.json: ${verRes.status}`);
      const verData = (await verRes.json()) as { version: string };

      // Get res mapping
      const resMapUrl = `https://game.maj-soul.com/1/resversion${verData.version}.json`;
      const mapRes = await fetch(resMapUrl);
      if (!mapRes.ok) throw new Error(`Failed to fetch res mapping: ${mapRes.status}`);
      const mapData = (await mapRes.json()) as {
        res: Record<string, { prefix: string }>;
      };

      const prefix = mapData.res['res/proto/liqi.json']?.prefix;
      if (!prefix) throw new Error('Could not find res/proto/liqi.json in mapping.');

      // Fetch liqi.json
      const liqiUrl = `https://game.maj-soul.com/1/${prefix}/res/proto/liqi.json`;
      const liqiRes = await fetch(liqiUrl);
      if (!liqiRes.ok) throw new Error(`Failed to fetch liqi.json: ${liqiRes.status}`);
      const liqiText = await liqiRes.text();

      // Save liqi.json locally to assets/liqi.json
      const { getAssetPath } = await import('./utils.js');
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const assetsDir = getAssetPath('assets');
      const parsedLiqi = JSON.parse(liqiText);
      const prettyLiqiText = JSON.stringify(parsedLiqi, null, 2);
      await writeFile(join(assetsDir, 'liqi.json'), prettyLiqiText, 'utf8');

      // Call bridgeManager to hot reload
      const { bridgeManager } = await import('./bridge/manager.js');
      bridgeManager.hotReloadLiqi();

      logger.info('Updated liqi.json successfully.');
      return true;
    } catch (err) {
      logger.error('Failed to update liqi.json:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  });

  // Open external URL in system browser
  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
        return true;
      }
      logger.warn(`Blocked opening non-http URL: ${url}`);
      return false;
    } catch {
      logger.error(`Invalid URL for open-external: ${url}`);
      return false;
    }
  });

  // Minimize Window
  ipcMain.handle('minimize-window', () => {
    const win = windowManager.getMainWindow();
    if (isSafeWindow(win)) {
      win.minimize();
    }
    return true;
  });

  // Close Window (Minimize to Tray)
  ipcMain.handle('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (isSafeWindow(win)) {
      win.close();
    }
    return true;
  });

  // Maximize / Restore Window
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

  // Check if window is maximized
  ipcMain.handle('is-window-maximized', () => {
    const win = windowManager.getMainWindow();
    return isSafeWindow(win) ? win.isMaximized() : false;
  });

  // Check resource status (lib/models)
  ipcMain.handle('check-resource-status', async () => {
    return backendManager.getResourceStatus();
  });

  // Wait for backend to be ready
  ipcMain.handle('wait-for-backend', async (_event, timeoutMs?: number) => {
    const isReady = await backendManager.waitForReady(timeoutMs);
    if (!isReady) throw new Error('Backend failed to start');
    return true;
  });

  // Sync locale across windows
  ipcMain.handle('update-locale', (_event, locale: string) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      safeSend(win, 'locale-changed', locale);
    });
    return true;
  });

  // Set window bounds (x, y, width, height)
  ipcMain.handle('set-window-bounds', (_event, bounds: Partial<Electron.Rectangle>) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (isSafeWindow(win)) {
      win.setBounds(bounds);
    }
    return true;
  });
}
