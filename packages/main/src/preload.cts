import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';

type IpcCallback = (event: IpcRendererEvent, ...args: readonly unknown[]) => void;

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  send: (channel: string, ...args: readonly unknown[]) => {
    ipcRenderer.send(channel, ...args);
  },

  on: (channel: string, func: (...args: readonly unknown[]) => void) => {
    const subscription: IpcCallback = (_event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  invoke: <TResult = unknown,>(channel: string, ...args: readonly unknown[]) => {
    return ipcRenderer.invoke(channel, ...args) as Promise<TResult>;
  },
});
