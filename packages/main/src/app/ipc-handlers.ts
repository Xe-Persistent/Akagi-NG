import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { createLogger, setLogLevel } from '../logging/index.js';
import { bridgeManager } from '../protocol/bridge-manager.js';
import type { MitmProxyManager } from '../services/capture/mitm-proxy.js';
import type { EngineService } from '../services/engine/engine-service.js';
import { resourceValidator } from '../services/resource-validator.js';
import type { AppSettings } from '../services/settings-manager.js';
import { settingsManager } from '../services/settings-manager.js';
import { EXIT_ANIMATION_DELAY_MS } from '../shared/constants.js';
import { getAssetPath } from '../shared/paths.js';
import { isSafeWindow, safeSend } from '../shared/utils.js';
import type { WindowManager } from './window-manager.js';

const logger = createLogger('IPC');

export function registerIpcHandlers(
  windowManager: WindowManager,
  engine: EngineService,
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

      if (updates.log_level) {
        setLogLevel(updates.log_level);
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

    // Run exit animation and engine shutdown in parallel
    await Promise.all([
      new Promise((resolve) => setTimeout(resolve, EXIT_ANIMATION_DELAY_MS)),
      Promise.resolve(engine.stop()).catch((err: unknown) =>
        logger.error('Engine shutdown error:', err),
      ),
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
      const assetsDir = getAssetPath('assets');
      const parsedLiqi = JSON.parse(liqiText);
      const prettyLiqiText = JSON.stringify(parsedLiqi, null, 2);
      await writeFile(join(assetsDir, 'liqi.json'), prettyLiqiText, 'utf8');

      // Reload the protocol inside the active bridge
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

  // Check that the model files the engine needs are present
  ipcMain.handle('check-resource-status', async () => {
    return await resourceValidator.validate();
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
