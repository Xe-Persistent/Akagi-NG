export interface ElectronApi {
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, func: (...args: unknown[]) => void) => () => void;
  invoke: (channel: string, data?: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    electron?: ElectronApi;
  }
}
