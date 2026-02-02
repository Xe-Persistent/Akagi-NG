// Electron IPC 通道类型定义

// ===== Invoke 通道参数类型 =====
interface InvokeChannelParams {
  'toggle-hud': boolean;
  'start-game': {
    url?: string;
    useMitm?: boolean;
    platform?: string;
  };
  'request-shutdown': void;
  'open-external': string;
  'minimize-window': void;
  'maximize-window': 'dashboard' | 'game' | undefined;
  'is-window-maximized': void;
  'check-resource-status': void;
  'get-app-version': void;
  'wait-for-backend': number | undefined;
}

// ===== Invoke 通道返回值类型 =====
interface InvokeChannelReturns {
  'toggle-hud': boolean;
  'start-game': boolean;
  'request-shutdown': boolean;
  'open-external': boolean;
  'minimize-window': boolean;
  'maximize-window': boolean;
  'is-window-maximized': boolean;
  'check-resource-status': {
    lib: boolean;
    models: boolean;
  };
  'get-app-version': string;
  'wait-for-backend': boolean;
}

// ===== On 通道事件参数类型 =====
interface OnChannelParams {
  'hud-visibility-changed': [visible: boolean];
  'window-state-changed': [maximized: boolean];
  'exit-animation-start': [];
  majsoul_proto_updated: [];
  majsoul_proto_update_failed: [error: string];
  'backend-ready': [];
}

// ===== 类型安全的 Electron API =====
export interface ElectronApi {
  /**
   * 向主进程发送单向消息
   * @param channel - IPC 通道名称
   * @param data - 要发送的数据
   */
  send: <K extends keyof InvokeChannelParams>(channel: K, data?: InvokeChannelParams[K]) => void;

  /**
   * 监听来自主进程的消息
   * @param channel - IPC 通道名称
   * @param func - 事件处理函数
   * @returns 取消监听的函数
   */
  on: <K extends keyof OnChannelParams>(
    channel: K,
    func: (...args: OnChannelParams[K]) => void,
  ) => () => void;

  /**
   * 向主进程发送请求并等待响应
   * @param channel - IPC 通道名称
   * @param data - 要发送的数据
   * @returns Promise,解析为响应数据
   */
  invoke: <K extends keyof InvokeChannelParams>(
    channel: K,
    data?: InvokeChannelParams[K],
  ) => Promise<InvokeChannelReturns[K]>;
}

declare global {
  interface Window {
    /**
     * Electron IPC API
     */
    electron: ElectronApi;
  }
}
