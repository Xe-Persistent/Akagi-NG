import { app, BrowserWindow, dialog } from 'electron';

import { BackendManager } from './backend-manager';
import {
  BACKEND_STARTUP_CHECK_INTERVAL_MS,
  BACKEND_STARTUP_CHECK_RETRIES,
  BACKEND_STARTUP_CHECK_TIMEOUT_MS,
} from './constants';
import { registerIpcHandlers } from './ipc-handlers';
import { WindowManager } from './window-manager';

const backendManager = new BackendManager();
const windowManager = new WindowManager(backendManager);

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
  dialog.showErrorBox('Main Process Crash', error.message || String(error));
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Rejection:', reason);
});

app.whenReady().then(async () => {
  // 1. Create Dashboard Window immediately to avoid white screen/no window during backend start
  await windowManager.createDashboardWindow();

  // 2. Register all IPC handlers
  registerIpcHandlers(windowManager, backendManager);

  // 3. Start Python Backend
  backendManager.start();

  // 4. Try to detect backend readiness (informative only, don't block the UI further)
  try {
    const { host, port } = backendManager.getBackendConfig();
    for (let i = 0; i < BACKEND_STARTUP_CHECK_RETRIES; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), BACKEND_STARTUP_CHECK_TIMEOUT_MS);
        await fetch(`http://${host}:${port}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        console.log(`[Main] Backend port ${port} is ready.`);
        backendManager.markReady();
        // Notify any windows that might be waiting
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('backend-ready');
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, BACKEND_STARTUP_CHECK_INTERVAL_MS));
      }
    }
  } catch (err) {
    console.warn('[Main] Backend port check ended:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createDashboardWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  windowManager.setQuitting(true);
  if (isQuitting) return;

  if (backendManager.isRunning()) {
    event.preventDefault();
    isQuitting = true;

    try {
      await backendManager.stop();
    } catch (err) {
      console.error('[Main] Error during shutdown:', err);
    } finally {
      app.quit();
    }
  }
});
