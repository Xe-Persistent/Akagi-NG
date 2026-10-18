export interface ElectronApi {
  /** The host platform: 'darwin', 'win32', 'linux', ... */
  readonly platform: NodeJS.Platform;
  /** Sends a one-way message to the main process. */
  send: (channel: string, ...args: readonly unknown[]) => void;

  /** Listens for a message from the main process; the result unsubscribes. */
  on: <TArgs extends readonly unknown[] = readonly unknown[]>(
    channel: string,
    func: (...args: TArgs) => void,
  ) => () => void;

  /** Sends a request to the main process and resolves with its answer. */
  invoke: <TResult = unknown>(channel: string, ...args: readonly unknown[]) => Promise<TResult>;
}

declare global {
  interface Window {
    electron: ElectronApi;
  }
}
