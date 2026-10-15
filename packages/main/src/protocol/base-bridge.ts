import type {
  AkagiEvent,
  AnkanEvent,
  ChiEvent,
  DahaiEvent,
  DaiminkanEvent,
  DoraEvent,
  EndGameEvent,
  EndKyokuEvent,
  KakanEvent,
  NotificationCode,
  NukidoraEvent,
  PonEvent,
  ReachAcceptedEvent,
  ReachEvent,
  StartGameEvent,
  StartKyokuEvent,
  SystemEvent,
  TsumoEvent,
} from '../shared/schema/mjai.js';

export abstract class BaseBridge {
  /** True while a reconnect replay is in progress; stamped on emitted events. */
  public syncing: boolean = false;

  public reset(): void {
    this.syncing = false;
  }

  /**
   * Parses a platform frame and returns the resulting mjai events.
   *
   * @param content - raw frame payload received from the game client
   * @returns mjai events, possibly empty when the frame carries no game state
   */
  public abstract parse(content: Buffer): AkagiEvent[];

  // ===== MJAI 消息构建器 =====

  private resolveSync(sync?: boolean): boolean {
    if (sync !== undefined) {
      return sync;
    }
    return this.syncing;
  }

  public makeStartGame(seat: number, is3p: boolean, sync?: boolean): StartGameEvent {
    return {
      type: 'start_game',
      id: seat,
      is_3p: is3p,
      sync: this.resolveSync(sync),
    };
  }

  public makeStartKyoku(
    bakaze: string,
    kyoku: number,
    honba: number,
    kyotaku: number,
    oya: number,
    doraMarker: string,
    scores: number[],
    tehais: string[][],
    sync?: boolean,
  ): StartKyokuEvent {
    return {
      type: 'start_kyoku',
      bakaze,
      kyoku,
      honba,
      kyotaku,
      oya,
      dora_marker: doraMarker,
      scores,
      tehais,
      sync: this.resolveSync(sync),
    };
  }

  public makeTsumo(actor: number, pai: string, sync?: boolean): TsumoEvent {
    return {
      type: 'tsumo',
      actor,
      pai,
      sync: this.resolveSync(sync),
    };
  }

  public makeDahai(actor: number, pai: string, tsumogiri: boolean, sync?: boolean): DahaiEvent {
    return {
      type: 'dahai',
      actor,
      pai,
      tsumogiri,
      sync: this.resolveSync(sync),
    };
  }

  public makeChi(
    actor: number,
    target: number,
    pai: string,
    consumed: string[],
    sync?: boolean,
  ): ChiEvent {
    return {
      type: 'chi',
      actor,
      target,
      pai,
      consumed,
      sync: this.resolveSync(sync),
    };
  }

  public makePon(
    actor: number,
    target: number,
    pai: string,
    consumed: string[],
    sync?: boolean,
  ): PonEvent {
    return {
      type: 'pon',
      actor,
      target,
      pai,
      consumed,
      sync: this.resolveSync(sync),
    };
  }

  public makeDaiminkan(
    actor: number,
    target: number,
    pai: string,
    consumed: string[],
    sync?: boolean,
  ): DaiminkanEvent {
    return {
      type: 'daiminkan',
      actor,
      target,
      pai,
      consumed,
      sync: this.resolveSync(sync),
    };
  }

  public makeAnkan(actor: number, consumed: string[], sync?: boolean): AnkanEvent {
    return {
      type: 'ankan',
      actor,
      consumed,
      sync: this.resolveSync(sync),
    };
  }

  public makeKakan(actor: number, pai: string, consumed: string[], sync?: boolean): KakanEvent {
    return {
      type: 'kakan',
      actor,
      pai,
      consumed,
      sync: this.resolveSync(sync),
    };
  }

  public makeReach(actor: number, sync?: boolean): ReachEvent {
    return {
      type: 'reach',
      actor,
      sync: this.resolveSync(sync),
    };
  }

  public makeReachAccepted(
    actor: number,
    deltas?: number[],
    scores?: number[],
    sync?: boolean,
  ): ReachAcceptedEvent {
    return {
      type: 'reach_accepted',
      actor,
      deltas,
      scores,
      sync: this.resolveSync(sync),
    };
  }

  public makeDora(doraMarker: string, sync?: boolean): DoraEvent {
    return {
      type: 'dora',
      dora_marker: doraMarker,
      sync: this.resolveSync(sync),
    };
  }

  public makeNukidora(actor: number, sync?: boolean): NukidoraEvent {
    return {
      type: 'nukidora',
      actor,
      pai: 'N',
      sync: this.resolveSync(sync),
    };
  }

  public makeEndKyoku(sync?: boolean): EndKyokuEvent {
    return {
      type: 'end_kyoku',
      sync: this.resolveSync(sync),
    };
  }

  public makeEndGame(sync?: boolean): EndGameEvent {
    return {
      type: 'end_game',
      sync: this.resolveSync(sync),
    };
  }

  public makeSystemEvent(code: NotificationCode): SystemEvent {
    return {
      type: 'system_event',
      code,
    };
  }
}
