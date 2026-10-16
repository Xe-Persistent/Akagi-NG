import { broadcastToWindows } from '../shared/broadcast.js';

/** Whether a game client websocket is currently open. */
export type ConnectionState = 'idle' | 'connected';

/** Whether the inference engine has usable weights. */
export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Things that happened once and leave no state behind. The sequence number lets
 * the renderer tell a repeat from the still-visible previous occurrence.
 */
export type EngineNotice =
  | { kind: 'parse_error'; seq: number }
  | { kind: 'runtime_error'; seq: number }
  | { kind: 'replay'; seq: number }
  | { kind: 'lobby_return'; seq: number }
  | { kind: 'game_dropped'; seq: number };

/** Everything the renderer needs to describe the engine, and nothing more. */
export interface EngineStatus {
  connection: ConnectionState;
  model: ModelState;
  modelName: string | null;
  /** The most recent one-shot event, part of the snapshot so a reload can check it. */
  notice: EngineNotice | null;
}

const INITIAL: EngineStatus = {
  connection: 'idle',
  model: 'idle',
  modelName: null,
  notice: null,
};

/**
 * Holds the engine's state and mirrors it to every window on change, so the
 * renderer can derive what to show instead of being told which notice to render.
 */
export class EngineStatusStore {
  private status: EngineStatus = INITIAL;
  private seq = 0;

  public get(): EngineStatus {
    return this.status;
  }

  /** Applies a state change; a no-op patch is not broadcast. */
  public set(patch: Partial<Omit<EngineStatus, 'notice'>>) {
    const next = { ...this.status, ...patch };
    if (isSameState(this.status, next)) return;

    this.status = next;
    this.publish();
  }

  /** Records a one-shot event; the sequence makes a repeat visible. */
  public notice(kind: EngineNotice['kind']) {
    this.status = { ...this.status, notice: { kind, seq: ++this.seq } };
    this.publish();
  }

  public reset() {
    this.status = INITIAL;
    this.publish();
  }

  private publish() {
    broadcastToWindows('engine:status', this.status);
  }
}

function isSameState(a: EngineStatus, b: EngineStatus): boolean {
  return a.connection === b.connection && a.model === b.model && a.modelName === b.modelName;
}

/** Single instance, like the bridge manager and the settings manager. */
export const engineStatus = new EngineStatusStore();
