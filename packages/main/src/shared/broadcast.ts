import { BrowserWindow } from 'electron';

/** Sends an IPC message to every live window; the renderer picks the channels it cares about. */
export function broadcastToWindows(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
