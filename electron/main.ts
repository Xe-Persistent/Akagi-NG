import { app, BrowserWindow } from 'electron';

import { BackendManager } from './backend-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { WindowManager } from './window-manager';

const windowManager = new WindowManager();
const backendManager = new BackendManager();

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting services...');

  // Start Python Backend
  backendManager.start();

  try {
    console.log('[Main] Waiting for backend port 8765...');
    for (let i = 0; i < 20; i++) {
      try {
        await fetch('http://127.0.0.1:8765');
        console.log('[Main] Backend port is ready.');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  } catch (err) {
    console.error('[Main] Timeout waiting for backend:', err);
  }

  // Register all IPC handlers
  registerIpcHandlers(windowManager, backendManager);

  await windowManager.createDashboardWindow();

  app.on('activate', () => {
    console.log('[Main] App activated.');
    if (BrowserWindow.getAllWindows().length === 0) {
      console.log('[Main] No windows found, creating Dashboard...');
      windowManager.createDashboardWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('[Main] All windows closed.');
  backendManager.stop();
  if (process.platform !== 'darwin') {
    console.log('[Main] Quitting app (window-all-closed)...');
    app.quit();
  }
});

app.on('before-quit', () => {
  windowManager.setQuitting(true);
});

app.on('will-quit', () => {
  console.log('[Main] App will-quit.');
  backendManager.stop();
  process.exit(0);
});
