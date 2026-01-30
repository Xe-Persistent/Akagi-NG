import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';

type IpcCallback = (event: IpcRendererEvent, ...args: unknown[]) => void;

contextBridge.exposeInMainWorld('electron', {
  // Generic send for now, we can strict type individual methods later
  send: (channel: string, data?: unknown) => ipcRenderer.send(channel, data),

  on: (channel: string, func: (...args: unknown[]) => void) => {
    const subscription: IpcCallback = (_event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  invoke: (channel: string, data?: unknown) => ipcRenderer.invoke(channel, data),
});
