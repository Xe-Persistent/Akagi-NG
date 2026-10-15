import { BrowserWindow, ipcMain } from 'electron';

import { createLogger, setLogLevel } from '../../logging/index.js';
import type { MitmProxyManager } from '../../services/capture/mitm-proxy.js';
import type { AppSettings } from '../../services/settings-manager.js';
import { settingsManager } from '../../services/settings-manager.js';
import { safeSend } from '../../shared/utils.js';

const logger = createLogger('IPC');

/** Settings reads/writes, plus applying what a change implies. */
export function registerSettingsHandlers(mitmProxyManager: MitmProxyManager) {
  ipcMain.handle('settings:get', () => {
    return settingsManager.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    try {
      settingsManager.updateSettings(updates);

      // A changed MITM configuration only takes effect after a restart.
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

  ipcMain.handle('update-locale', (_event, locale: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      safeSend(win, 'locale-changed', locale);
    }
    return true;
  });
}
