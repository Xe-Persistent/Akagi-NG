import { broadcastToWindows } from '../../shared/broadcast.js';
import type { SystemEvent } from '../../shared/schema/mjai.js';
import { NotificationCode } from '../../shared/schema/mjai.js';

export type NotificationLevel = 'error' | 'warning' | 'info' | 'success';

export interface NotificationItem {
  level: NotificationLevel;
  code: NotificationCode;
}

/** Notifications that describe a moment rather than an ongoing problem. */
const TRANSIENT_MS: Partial<Record<NotificationCode, number>> = {
  [NotificationCode.CLIENT_CONNECTED]: 5000,
  [NotificationCode.GAME_CONNECTED]: 5000,
  [NotificationCode.GAME_SYNCING]: 8000,
  [NotificationCode.MODEL_LOADED_LOCAL]: 5000,
  [NotificationCode.RETURN_LOBBY]: 5000,
  [NotificationCode.PARSE_ERROR]: 8000,
  [NotificationCode.BOT_RUNTIME_ERROR]: 10000,
};

/** Codes the HUD should render as a warning instead of an info line. */
const WARNING_CODES = new Set<NotificationCode>([NotificationCode.PARSE_ERROR]);

/**
 * Keeps the set of notifications the HUD is currently showing and mirrors the
 * complete list to the renderer on every change, so the UI never has to replay
 * events.
 */
export class NotificationCenter {
  private readonly active = new Map<NotificationCode, NotificationItem>();
  private readonly timers = new Map<NotificationCode, NodeJS.Timeout>();

  /** Shows a notification, replacing an earlier one with the same code. */
  public show(level: NotificationLevel, code: NotificationCode) {
    this.active.set(code, { level, code });

    const previousTimer = this.timers.get(code);
    if (previousTimer) clearTimeout(previousTimer);

    const transientMs = TRANSIENT_MS[code];
    if (transientMs !== undefined) {
      this.timers.set(
        code,
        setTimeout(() => this.clear(code), transientMs),
      );
    }

    this.publish();
  }

  public clear(code: NotificationCode) {
    const timer = this.timers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(code);
    }

    if (!this.active.delete(code)) return;
    this.publish();
  }

  public clearAll() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.active.clear();
  }

  /** Surfaces a `system_event` from the protocol layer as a HUD notification. */
  public forwardSystemEvent(ev: SystemEvent) {
    this.show(WARNING_CODES.has(ev.code) ? 'warning' : 'info', ev.code);
  }

  private publish() {
    broadcastToWindows('engine:notification', { list: [...this.active.values()] });
  }
}
