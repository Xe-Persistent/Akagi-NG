import type { ResourceStatus } from '@/types';

/**
 * The window and app commands the renderer sends to the main process.
 *
 * Channel names live here rather than at the call sites, so a handler cannot be
 * renamed on one side only, and so the renderer never spells a channel twice.
 */

export function minimizeWindow(): Promise<void> {
  return window.electron.invoke<void>('minimize-window');
}

export function maximizeWindow(): Promise<void> {
  return window.electron.invoke<void>('maximize-window');
}

export function isWindowMaximized(): Promise<boolean> {
  return window.electron.invoke<boolean>('is-window-maximized');
}

/** Hides the dashboard to the tray; quitting is a separate command. */
export function closeWindow(): Promise<void> {
  return window.electron.invoke<void>('close-window');
}

export function requestShutdown(): Promise<void> {
  return window.electron.invoke<void>('request-shutdown');
}

/** Tells the main process the stopped screen has finished its fade and hold. */
export function notifyExitAnimationComplete(): void {
  window.electron.send('exit-animation-complete');
}

/** Opens a URL in the system browser. The main process refuses anything but http(s). */
export function openExternal(url: string): Promise<void> {
  return window.electron.invoke<void>('open-external', url);
}

export function toggleHud(show: boolean): Promise<void> {
  return window.electron.invoke<void>('toggle-hud', show);
}

export interface StartGameOptions {
  url: string;
  useMitm: boolean;
}

export function startGame(options: StartGameOptions): Promise<void> {
  return window.electron.invoke<void>('start-game', options);
}

/** Whether the model files the app needs are present next to the executable. */
export function checkResourceStatus(): Promise<ResourceStatus> {
  return window.electron.invoke<ResourceStatus>('check-resource-status');
}

/** The update the main process already found, for a badge that mounted later. */
export function fetchUpdateVersionApi(): Promise<string | null> {
  return window.electron.invoke<string | null>('app:update:get');
}

/** Regenerates the Majsoul protocol files from the installed game client. */
export function updateLiqi(): Promise<void> {
  return window.electron.invoke<void>('update-liqi');
}
