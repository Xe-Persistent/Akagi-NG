import { BrowserWindow } from 'electron';

import { safeSend } from './utils.js';

/** Sends an IPC message to every live window; the renderer picks the channels it cares about. */
export function broadcastToWindows(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    safeSend(win, channel, payload);
  }
}
