/**
 * Stand-in for `electron`, aliased in by `vitest.config.ts`. It covers what the
 * main-process modules touch at import time and records every broadcast, so a
 * test can assert on what the renderer would have received.
 *
 * Windows and trays are recorded rather than created, and `ipcMain.handle`
 * keeps the handler it was given so a test can invoke a channel directly: the
 * IPC surface and the window classes have no other way to be reached under
 * plain Node.
 *
 * The app reports itself as packaged with `process.resourcesPath` pointing at the
 * repository, which makes `getProjectRoot()` resolve to the checkout: that is
 * where `assets/` and `models/` actually live.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SentMessage {
  channel: string;
  payload: unknown;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Where `getProjectRoot()` should point. The checkout works for everything that
 * reads `assets/` or `models/`; a test that writes (the settings store) points it
 * at a temporary directory instead.
 */
export const testPaths = { projectRoot: repoRoot };

/** Everything the main process broadcast, oldest first. */
export const sentMessages: SentMessage[] = [];

/** Clears the broadcast record; call it from `beforeEach`. */
export function resetSentMessages() {
  sentMessages.length = 0;
}

/** The payloads sent on one channel, in order. */
export function messagesOn<T = unknown>(channel: string): T[] {
  return sentMessages.filter((m) => m.channel === channel).map((m) => m.payload as T);
}

// `getProjectRoot()` reads this when the app is packaged; Node types it as
// read-only and has no such property at all.
Object.defineProperty(process, 'resourcesPath', {
  get: () => join(testPaths.projectRoot, 'Resources'),
  configurable: true,
});

/** The subset of `EventEmitter` Electron's objects expose. */
class Emitter {
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();

  public on(event: string, listener: (...args: never[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  public once(event: string, listener: (...args: never[]) => void) {
    const wrapper = (...args: never[]) => {
      this.removeListener(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  public off(event: string, listener: (...args: never[]) => void) {
    return this.removeListener(event, listener);
  }

  public removeListener(event: string, listener: (...args: never[]) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  public removeAllListeners(event?: string) {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  /** Delivers an event to every listener; a test calls this to drive the object. */
  public emit(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
    return true;
  }

  public listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** Everything a `Session` needs for the capture and proxy paths under test. */
export interface FakeSession {
  webRequest: { onBeforeRequest: (...args: unknown[]) => void };
  setPermissionRequestHandler: (handler: unknown) => void;
  setPermissionCheckHandler: (handler: unknown) => void;
  setCertificateVerifyProc: (handler: unknown) => void;
  setProxy: (config: unknown) => Promise<void>;
  proxyConfigs: unknown[];
  permissionHandlers: unknown[];
  certificateVerifyProcs: unknown[];
}

export function createSession(): FakeSession {
  const session: FakeSession = {
    webRequest: { onBeforeRequest: () => {} },
    setPermissionRequestHandler: (handler) => {
      session.permissionHandlers.push(handler);
    },
    setPermissionCheckHandler: () => {},
    setCertificateVerifyProc: (handler) => {
      session.certificateVerifyProcs.push(handler);
    },
    setProxy: async (config) => {
      session.proxyConfigs.push(config);
    },
    proxyConfigs: [],
    permissionHandlers: [],
    certificateVerifyProcs: [],
  };
  return session;
}

/** What a window did, in call order, for tests that assert on the sequence. */
export interface WindowCall {
  method: string;
  args: unknown[];
}

const windows: FakeBrowserWindow[] = [];

export interface FakeDebugger extends Emitter {
  attached: boolean;
  attachCalls: string[];
  detachCalls: number;
  commands: string[];
  failAttach: Error | null;
  isAttached: () => boolean;
  attach: (version: string) => void;
  detach: () => void;
  sendCommand: (method: string) => Promise<unknown>;
}

function createDebugger(): FakeDebugger {
  const stub = new Emitter() as FakeDebugger;
  stub.attached = false;
  stub.attachCalls = [];
  stub.detachCalls = 0;
  stub.commands = [];
  stub.failAttach = null;
  stub.isAttached = () => stub.attached;
  stub.attach = (version: string) => {
    if (stub.failAttach) throw stub.failAttach;
    stub.attachCalls.push(version);
    stub.attached = true;
  };
  stub.detach = () => {
    stub.detachCalls += 1;
    stub.attached = false;
  };
  stub.sendCommand = async (method: string) => {
    stub.commands.push(method);
    return {};
  };
  return stub;
}

class FakeWebContents extends Emitter {
  public static nextId = 1;

  public readonly id = FakeWebContents.nextId++;
  public readonly session = createSession();
  public readonly debugger = createDebugger();
  public destroyed = false;
  public devToolsOpened = 0;
  /** What the page asked Electron to do about a new window. */
  public windowOpenHandler: ((details: { url: string }) => unknown) | null = null;

  public isDestroyed() {
    return this.destroyed;
  }

  public send(channel: string, ...args: unknown[]) {
    sentMessages.push({ channel, payload: args[0] });
  }

  public openDevTools() {
    this.devToolsOpened += 1;
  }

  public setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
    this.windowOpenHandler = handler;
  }
}

export class FakeBrowserWindow extends Emitter {
  public static getAllWindows(): FakeBrowserWindow[] {
    // Existing tests never construct a window; they only use the static API and
    // expect one unnamed window to receive broadcasts.
    return windows.length > 0 ? [...windows] : [fallbackWindow];
  }

  public static fromWebContents(sender: unknown): FakeBrowserWindow | null {
    return windows.find((window) => window.webContents === sender) ?? null;
  }

  /** Clears the registry; call it from `beforeEach` in a test that opens windows. */
  public static resetInstances() {
    windows.length = 0;
  }

  public readonly options: Record<string, unknown>;
  public readonly calls: WindowCall[] = [];
  public readonly webContents: FakeWebContents;
  public destroyed = false;
  public visible = false;
  public maximized = false;
  public minimized = false;
  public fullScreen = false;
  public opacity = 1;
  public position: [number, number] = [0, 0];
  /** When set, `loadURL`/`loadFile` reject with it instead of resolving. */
  public loadError: Error | null = null;

  public constructor(options: Record<string, unknown> = {}) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    windows.push(this);
  }

  /** Every set of arguments `method` was called with, in order. */
  public callsTo(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  public isDestroyed() {
    return this.destroyed;
  }

  public destroy() {
    this.destroyed = true;
    this.emit('closed');
  }

  public close() {
    this.calls.push({ method: 'close', args: [] });
    const event = {
      defaultPrevented: false,
      preventDefault: () => {
        event.defaultPrevented = true;
      },
    };
    this.emit('close', event);
    // A prevented close keeps the window alive, which is how Electron behaves.
    if (!event.defaultPrevented) this.destroy();
    return event;
  }

  public show() {
    this.visible = true;
    this.calls.push({ method: 'show', args: [] });
    return this;
  }

  public hide() {
    this.visible = false;
    this.calls.push({ method: 'hide', args: [] });
    return this;
  }

  public focus() {
    this.calls.push({ method: 'focus', args: [] });
    return this;
  }

  public isVisible() {
    return this.visible;
  }

  public minimize() {
    this.minimized = true;
    this.calls.push({ method: 'minimize', args: [] });
    return this;
  }

  public restore() {
    this.minimized = false;
    this.calls.push({ method: 'restore', args: [] });
    return this;
  }

  public isMinimized() {
    return this.minimized;
  }

  public maximize() {
    this.maximized = true;
    this.calls.push({ method: 'maximize', args: [] });
    this.emit('maximize');
    return this;
  }

  public unmaximize() {
    this.maximized = false;
    this.calls.push({ method: 'unmaximize', args: [] });
    this.emit('unmaximize');
    return this;
  }

  public isMaximized() {
    return this.maximized;
  }

  public setFullScreen(value: boolean) {
    this.fullScreen = value;
    this.calls.push({ method: 'setFullScreen', args: [value] });
    return this;
  }

  public isFullScreen() {
    return this.fullScreen;
  }

  public setOpacity(value: number) {
    this.opacity = value;
    this.calls.push({ method: 'setOpacity', args: [value] });
    return this;
  }

  public getOpacity() {
    return this.opacity;
  }

  public setAlwaysOnTop(...args: unknown[]) {
    this.calls.push({ method: 'setAlwaysOnTop', args });
    return this;
  }

  public setVisibleOnAllWorkspaces(...args: unknown[]) {
    this.calls.push({ method: 'setVisibleOnAllWorkspaces', args });
    return this;
  }

  public setAspectRatio(value: number) {
    this.calls.push({ method: 'setAspectRatio', args: [value] });
    return this;
  }

  public getPosition(): [number, number] {
    return this.position;
  }

  public setPosition(x: number, y: number) {
    this.position = [x, y];
    this.calls.push({ method: 'setPosition', args: [x, y] });
    return this;
  }

  public async loadURL(url: string) {
    this.calls.push({ method: 'loadURL', args: [url] });
    if (this.loadError) throw this.loadError;
  }

  public async loadFile(path: string, options?: unknown) {
    this.calls.push({ method: 'loadFile', args: [path, options] });
    if (this.loadError) throw this.loadError;
  }
}

/**
 * The window `broadcastToWindows` and `getAllWindows()` see when a test never
 * opened one. Keeping it means a module that broadcasts needs no window to be
 * exercised.
 */
const fallbackWindow = new FakeBrowserWindow({ fallback: true });
windows.length = 0;

/** Everything the tray menu was built from, and what the tray was told. */
export interface FakeTray extends Emitter {
  icon: unknown;
  toolTip: string | null;
  menu: unknown;
}

export class Tray extends Emitter implements FakeTray {
  public static readonly instances: FakeTray[] = [];

  public readonly icon: unknown;
  public toolTip: string | null = null;
  public menu: unknown = null;

  public constructor(icon: unknown) {
    super();
    this.icon = icon;
    Tray.instances.push(this);
  }

  public static resetInstances() {
    Tray.instances.length = 0;
  }

  public setToolTip(value: string) {
    this.toolTip = value;
    return this;
  }

  public setContextMenu(menu: unknown) {
    this.menu = menu;
    return this;
  }
}

/** One row of the template `Menu.buildFromTemplate` was handed. */
export interface FakeMenuItem {
  label?: string;
  type?: string;
  enabled?: boolean;
  click?: () => void;
}

export class Menu {
  public static built: FakeMenuItem[][] = [];

  public static buildFromTemplate(template: FakeMenuItem[]) {
    Menu.built.push(template);
    return { template };
  }

  public static reset() {
    Menu.built.length = 0;
  }
}

/** Path `nativeImage.createFromPath` was asked for, plus the template flag. */
export interface FakeNativeImage {
  path: string;
  template: boolean;
  setTemplateImage: (value: boolean) => void;
}

export const nativeImage = {
  createFromPath: (path: string): FakeNativeImage => {
    const image: FakeNativeImage = {
      path,
      template: false,
      setTemplateImage: (value: boolean) => {
        image.template = value;
      },
    };
    return image;
  },
};

export const app = {
  isPackaged: true,
  name: 'akagi-ng',
  getName: () => 'akagi-ng',
  getLocale: () => 'zh-CN',
  getVersion: () => '0.0.0-test',
  getPath: (name: string) => join(process.env.TEMP ?? process.cwd(), 'akagi-ng-test', name),
  getAppPath: () => repoRoot,
  isReady: () => true,
  requestSingleInstanceLock: () => true,
  on: () => {},
  once: () => {},
  off: () => {},
  quit: () => {},
  whenReady: () => Promise.resolve(),
};

export const webContents = { getAllWebContents: () => [] };

type IpcListener = (event: unknown, ...args: unknown[]) => void;

const ipcListeners = new Map<string, Set<IpcListener>>();
const ipcHandlers = new Map<string, IpcListener>();

export const ipcMain = {
  handle: (channel: string, handler: IpcListener) => {
    ipcHandlers.set(channel, handler);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
  on: (channel: string, listener: IpcListener) => {
    const listeners = ipcListeners.get(channel) ?? new Set<IpcListener>();
    listeners.add(listener);
    ipcListeners.set(channel, listeners);
  },
  off: (channel: string, listener: IpcListener) => {
    ipcListeners.get(channel)?.delete(listener);
  },
  removeListener: (channel: string, listener: IpcListener) => {
    ipcListeners.get(channel)?.delete(listener);
  },
};

/** Delivers a main-process event to the listeners registered on `channel`. */
export function emitIpcMain(channel: string, event: unknown, ...args: unknown[]) {
  for (const listener of ipcListeners.get(channel) ?? []) {
    listener(event, ...args);
  }
}

/** Whether a handler was registered for a channel, as `ipcMain.handle` would. */
export function handlesChannel(channel: string): boolean {
  return ipcHandlers.has(channel);
}

/** Every channel a handler was registered for, in registration order. */
export function handledChannels(): string[] {
  return [...ipcHandlers.keys()];
}

/**
 * Invokes a registered handler the way `ipcMain.handle` would, with the sender
 * the caller supplies. Throws when nothing handles the channel, so a missing
 * registration fails the test instead of the app.
 */
export function invokeIpc<T = unknown>(
  channel: string,
  sender: unknown = { id: 1 },
  ...args: unknown[]
): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve(handler({ sender }, ...args) as T);
}

/** Clears the listener and handler registries; call it from `beforeEach`. */
export function resetIpcListeners() {
  ipcListeners.clear();
  ipcHandlers.clear();
}

/** URLs `shell.openExternal` was handed, in order. */
export const openedExternal: string[] = [];

export function resetOpenedExternal() {
  openedExternal.length = 0;
}

export const shell = {
  openExternal: async (url: string) => {
    openedExternal.push(url);
  },
};

/** Error boxes and message boxes a test can assert on. */
export const dialogs = {
  errorBoxes: [] as { title: string; content: string }[],
  messageBoxes: [] as unknown[],
};

export const dialog = {
  showErrorBox: (title: string, content: string) => {
    dialogs.errorBoxes.push({ title, content });
  },
  showMessageBox: async (options: unknown) => {
    dialogs.messageBoxes.push(options);
    return { response: 0 };
  },
};

/**
 * Stand-in for OS-backed credential storage: a reversible prefix instead of
 * DPAPI/Keychain, so the store's file format and round-trip can be tested.
 */
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`stub:${value}`, 'utf8'),
  decryptString: (value: Buffer) => {
    const text = value.toString('utf8');
    if (!text.startsWith('stub:')) throw new Error('not encrypted by this backend');
    return text.slice('stub:'.length);
  },
};

export const session = { defaultSession: createSession() };
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) };
export const nativeTheme = { shouldUseDarkColors: false, on: () => {} };

/** The `net.fetch` implementation a test installs; packaged-app paths need it. */
let netFetch: (input: string, init?: unknown) => Promise<unknown> = async () => {
  throw new Error('net.fetch was not stubbed for this test');
};

export const net = {
  fetch: (input: string, init?: unknown) => netFetch(input, init),
};

export function setNetFetch(impl: (input: string, init?: unknown) => Promise<unknown>) {
  netFetch = impl;
}

export function resetNetFetch() {
  netFetch = async () => {
    throw new Error('net.fetch was not stubbed for this test');
  };
}

/** `BrowserWindow` is the recorded class above; the name is what src imports. */
export { FakeBrowserWindow as BrowserWindow };

// Some dependencies (electron-store) import the whole module as a default export.
export default {
  app,
  BrowserWindow: FakeBrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  webContents,
};
