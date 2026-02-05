import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';

type IpcCallback = (event: IpcRendererEvent, ...args: unknown[]) => void;

const VALID_INVOKE_CHANNELS = [
  'toggle-hud',
  'start-game',
  'request-shutdown',
  'open-external',
  'minimize-window',
  'maximize-window',
  'is-window-maximized',
  'check-resource-status',
  'get-app-version',
  'wait-for-backend',
  'update-locale',
  'set-window-bounds',
  'get-backend-config',
] as const;

const VALID_ON_CHANNELS = [
  'hud-visibility-changed',
  'window-state-changed',
  'exit-animation-start',
  'majsoul_proto_updated',
  'majsoul_proto_update_failed',
  'backend-ready',
  'locale-changed',
] as const;

contextBridge.exposeInMainWorld('electron', {
  send: (channel: string, data?: unknown) => {
    if ((VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel: string, func: (...args: unknown[]) => void) => {
    if ((VALID_ON_CHANNELS as readonly string[]).includes(channel)) {
      const subscription: IpcCallback = (_event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },

  invoke: (channel: string, data?: unknown) => {
    if ((VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
  },
});
