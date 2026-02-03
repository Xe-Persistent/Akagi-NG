import { app, BrowserWindow, dialog } from 'electron';

import { BackendManager } from './backend-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { WindowManager } from './window-manager';

const windowManager = new WindowManager();
const backendManager = new BackendManager();

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
    for (let i = 0; i < 20; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s timeout per check
        await fetch('http://127.0.0.1:8765', { signal: controller.signal });
        clearTimeout(timeoutId);
        console.log('[Main] Backend port is ready.');
        backendManager.markReady();
        // Notify any windows that might be waiting
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('backend-ready');
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
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
