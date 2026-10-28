import { app, ipcMain, shell } from 'electron';

import { createLogger } from '../../logging/index.js';
import { engineStatus } from '../../services/engine-status.js';
import { updateMajsoulProtocol } from '../../services/protocol-updater.js';
import { resourceValidator } from '../../services/resource-validator.js';
import type { UpdaterManager } from '../updater.js';

const logger = createLogger('IPC');

/** System-level requests: shutdown, updates, bundled resources, protocol and links. */
export function registerSystemHandlers(updater: UpdaterManager) {
  // Shutdown is orchestrated by `ShutdownCoordinator` through `before-quit`, so
  // every quit path plays the same exit sequence.
  ipcMain.handle('request-shutdown', () => {
    app.quit();
    return true;
  });

  // The update event is broadcast once, possibly before the badge exists.
  ipcMain.handle('app:update:get', () => updater.getAvailableVersion());

  ipcMain.handle('check-resource-status', () => resourceValidator.validate());

  // A window that opens mid-session asks for the current status instead of
  // waiting for the next change.
  ipcMain.handle('engine:status:get', () => {
    return engineStatus.get();
  });

  ipcMain.handle('update-liqi', async () => {
    await updateMajsoulProtocol();
    return true;
  });

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
}
