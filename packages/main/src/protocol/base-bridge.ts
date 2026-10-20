import type {
  AnkanEvent,
  ChiEvent,
  DahaiEvent,
  DaiminkanEvent,
  DoraEvent,
  EndGameEvent,
  EndKyokuEvent,
  HoraEvent,
  KakanEvent,
  MJAIEvent,
  NukidoraEvent,
  PonEvent,
  ReachAcceptedEvent,
  ReachEvent,
  RyukyokuEvent,
  StartGameEvent,
  StartKyokuEvent,
  TsumoEvent,
} from '../shared/schema/mjai.js';

/**
 * What one captured frame produced: the game events it carried, plus the two
 * facts the session status needs (a frame that could not be decoded, and whether
 * the events are part of a reconnect replay).
 */
export interface BridgeOutput {
  events: MJAIEvent[];
  /**
   * A frame that was understood as a game message but could not be turned into
   * events. A frame that carries no liqi message at all is not a failure.
   */
  parseFailed?: boolean;
  /**
   * The frame replayed a restore's action history, so everything but the last
   * event describes a position the game has already left.
   */
  replayed?: boolean;
}

export abstract class BaseBridge {
  /**
   * Parses a platform frame and returns the resulting mjai events.
   *
   * @param content - raw frame payload received from the game client
   * @param source - capture path that saw the frame, for the verbose capture log
   * @returns the events plus the session facts the frame implies
   */
  public abstract parse(content: Buffer, source?: string): BridgeOutput;

  // ===== MJAI message builders =====

  public makeStartGame(seat: number, is3p: boolean): StartGameEvent {
    return {
      type: 'start_game',
      id: seat,
      is_3p: is3p,
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
    };
  }

  public makeTsumo(actor: number, pai: string): TsumoEvent {
    return {
      type: 'tsumo',
      actor,
      pai,
    };
  }

  public makeDahai(actor: number, pai: string, tsumogiri: boolean): DahaiEvent {
    return {
      type: 'dahai',
      actor,
      pai,
      tsumogiri,
    };
  }

  public makeChi(actor: number, target: number, pai: string, consumed: string[]): ChiEvent {
    return {
      type: 'chi',
      actor,
      target,
      pai,
      consumed,
    };
  }

  public makePon(actor: number, target: number, pai: string, consumed: string[]): PonEvent {
    return {
      type: 'pon',
      actor,
      target,
      pai,
      consumed,
    };
  }

  public makeDaiminkan(
    actor: number,
    target: number,
    pai: string,
    consumed: string[],
  ): DaiminkanEvent {
    return {
      type: 'daiminkan',
      actor,
      target,
      pai,
      consumed,
    };
  }

  public makeAnkan(actor: number, consumed: string[]): AnkanEvent {
    return {
      type: 'ankan',
      actor,
      consumed,
    };
  }

  public makeKakan(actor: number, pai: string, consumed: string[]): KakanEvent {
    return {
      type: 'kakan',
      actor,
      pai,
      consumed,
    };
  }

  public makeReach(actor: number): ReachEvent {
    return {
      type: 'reach',
      actor,
    };
  }

  public makeReachAccepted(
    actor: number,
    deltas?: number[],
    scores?: number[],
  ): ReachAcceptedEvent {
    return {
      type: 'reach_accepted',
      actor,
      deltas,
      scores,
    };
  }

  public makeDora(doraMarker: string): DoraEvent {
    return {
      type: 'dora',
      dora_marker: doraMarker,
    };
  }

  public makeNukidora(actor: number): NukidoraEvent {
    return {
      type: 'kita',
      actor,
      pai: 'N',
    };
  }

  public makeEndKyoku(): EndKyokuEvent {
    return {
      type: 'end_kyoku',
    };
  }

  /**
   * A win. `target` is the player who dealt in, or null for a self-draw. The
   * deltas come from the game itself, because a mode may settle them its own way
   * (xuezhan hands the winner the riichi pot, so they do not sum to zero).
   */
  public makeHora(
    actor: number,
    target: number,
    pai: string,
    scores: number[],
    deltas: number[],
  ): HoraEvent {
    return {
      type: 'hora',
      actor,
      target,
      pai,
      scores,
      deltas,
    };
  }

  /**
   * A draw, with the payments the game reported and, when the protocol says so,
   * why the hand was aborted. The reason strings are the ones `riichienv` uses
   * for its own draws, so a replayed and a live round describe themselves alike.
   */
  public makeRyukyoku(
    scores: number[],
    deltas: number[],
    tenpais: boolean[],
    reason?: string,
  ): RyukyokuEvent {
    return {
      type: 'ryukyoku',
      scores,
      deltas,
      tenpais,
      ...(reason ? { reason } : {}),
    };
  }

  public makeEndGame(): EndGameEvent {
    return {
      type: 'end_game',
    };
  }
}
