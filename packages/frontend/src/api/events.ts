import { parseEngineStatus, parseRecommendations } from '@/lib/engine-payload';
import type { EngineStatus, ExitAnimationTiming, RecommendationData } from '@/types';

/** Stops listening; every `on…` below returns one. */
type Unsubscribe = () => void;

/**
 * The main → renderer channels.
 *
 * The invoke channels are wrapped in `desktop.ts`, `engine.ts`, `online.ts` and
 * `settings.ts`; these are the events the main process pushes on its own. Kept
 * together for the same reason: a channel renamed on one side must not stay
 * silently correct on the other.
 *
 * The two engine payloads are checked before they reach a handler — they are the
 * only ones whose content the renderer walks into.
 */
export function onEngineStatus(handler: (status: EngineStatus) => void): Unsubscribe {
  return window.electron.on('engine:status', (payload: unknown) => {
    const status = parseEngineStatus(payload);
    if (status) handler(status);
    else console.error('Ignoring a malformed engine:status payload:', payload);
  });
}

export function onRecommendations(handler: (data: RecommendationData) => void): Unsubscribe {
  return window.electron.on('engine:recommendations', (payload: unknown) => {
    const data = parseRecommendations(payload);
    if (data) handler(data);
    else console.error('Ignoring a malformed engine:recommendations payload:', payload);
  });
}

export function onWindowStateChanged(handler: (maximized: boolean) => void): Unsubscribe {
  return window.electron.on<[boolean]>('window-state-changed', handler);
}

export function onHudVisibilityChanged(handler: (visible: boolean) => void): Unsubscribe {
  return window.electron.on<[boolean]>('hud-visibility-changed', handler);
}

export function onLocaleChanged(handler: (locale: string) => void): Unsubscribe {
  return window.electron.on<[string]>('locale-changed', handler);
}

export function onExitAnimationStart(handler: (timing: ExitAnimationTiming) => void): Unsubscribe {
  return window.electron.on<[ExitAnimationTiming]>('exit-animation-start', handler);
}

export function onUpdateAvailable(handler: (version: string) => void): Unsubscribe {
  return window.electron.on<[string]>('app:update-available', handler);
}

/** The tray asked to quit and the dashboard owns the confirmation dialog. */
export function onRequestAppQuit(handler: () => void): Unsubscribe {
  return window.electron.on('request-app-quit', handler);
}
