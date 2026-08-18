// ===== Electron IPC API =====
export interface ElectronApi {
  /** 当前操作系统平台（如 'darwin'、'win32'、'linux'） */
  readonly platform: NodeJS.Platform;
  /**
   * 向主进程发送单向消息
   * @param channel IPC 通道名称
   * @param args 要发送的数据
   */
  send: (channel: string, ...args: readonly unknown[]) => void;

  /**
   * 监听来自主进程的消息
   * @param channel IPC 通道名称
   * @param func 事件处理函数
   * @returns 取消监听的函数
   */
  on: <TArgs extends readonly unknown[] = readonly unknown[]>(
    channel: string,
    func: (...args: TArgs) => void,
  ) => () => void;

  /**
   * 向主进程发送请求并等待响应
   * @param channel IPC 通道名称
   * @param args 要发送的数据
   */
  invoke: <TResult = unknown>(channel: string, ...args: readonly unknown[]) => Promise<TResult>;
}

declare global {
  interface Window {
    electron: ElectronApi;
  }
}
