import { createLogger } from '../../logging/index.js';
import { errorMessage } from '../../shared/errors.js';
import { MahjongConstants } from '../../shared/schema/mahjong.js';
import type { MJAIEvent } from '../../shared/schema/mjai.js';
import type { BridgeOutput } from '../base-bridge.js';
import { BaseBridge } from '../base-bridge.js';
import type { LiqiMessage } from './liqi.js';
import { LiqiProto, MsgType } from './liqi.js';
import { MajsoulStateTracker } from './state-tracker.js';
import { is3pFromSyncSnapshot, parseSyncGameActions } from './sync-replay.js';
import { toMjaiTile } from './tile-mapping.js';
import { MAJSOUL_METHODS, OperationAnGangAddGang, OperationChiPengGang } from './wire.js';
import { applySwap, isXuezhanRule } from './xuezhan.js';

const logger = createLogger('MajsoulBridge');

/** Decoded fields of one protocol message; its shape is only known at runtime. */
type ActionPayload = Record<string, unknown>;

/** An `ActionPrototype` frame: the action's name plus its own decoded payload. */
interface ActionPrototype extends ActionPayload {
  name: string;
  data: ActionPayload;
}

/**
 * How many tiles each call reports. The protocol guarantees these counts, so the
 * handlers turn any other length into a hard error rather than a silent meld.
 */
const MELD_TILES = {
  chi: 2,
  pon: 2,
  daiminkan: 3,
  ankan: 4,
  kakan: 3,
} as const;

/** `chang` (the round-wind index) to the mjai round-wind tile. */
const ROUND_WINDS = ['E', 'S', 'W', 'N'] as const;

/** ActionPrototype names that end the current kyoku. */
const END_ROUND_ACTIONS = new Set(['ActionHule', 'ActionNoTile', 'ActionLiuJu']);

/** `ActionLiuJu.type` for 三家和了, which is a ron and not an ordinary abort. */
const LIUJU_THREE_RONS = 5;

/** Round-level actions that mean a swap will never arrive for a held deal. */
const STALE_DEAL_ACTIONS = new Set([
  ...END_ROUND_ACTIONS,
  'ActionNewRound',
  'ActionHuleXueZhanMid',
  'ActionHuleXueZhanEnd',
]);

/** The round's first dora marker, before any indicator has been reported. */
function toMjaiTileOrUnknown(doras: string[] | undefined): string {
  const first = doras?.[0];
  return first ? toMjaiTile(first) : MahjongConstants.UNKNOWN_TILE;
}

/** A five of a numbered suit; an honor such as 5z is not a suit five. */
function isSuitFive(pai: string): boolean {
  return pai[0] === '5' && pai[1] !== 'z';
}

function isRedFive(pai: string): boolean {
  return pai.endsWith('r');
}

export class MajsoulBridge extends BaseBridge {
  public readonly liqiProto: LiqiProto = new LiqiProto();
  private readonly state = new MajsoulStateTracker();
  /** Set while the frame being parsed is a reconnect replay. */
  private replayed = false;

  private readonly actionHandlers: Readonly<
    Record<string, (action: ActionPrototype) => MJAIEvent[]>
  > = {
    ActionNewRound: (action) => this.handleNewRound(action),
    ActionDealTile: (action) => this.handleDealTile(action),
    ActionDiscardTile: (action) => this.handleDiscardTile(action),
    ActionChiPengGang: (action) => this.handleChiPengGang(action),
    ActionAnGangAddGang: (action) => this.handleAnGangAddGang(action),
    ActionBaBei: (action) => this.handleBaBei(action),
    ActionChangeTile: (action) => this.handleChangeTile(action),
    ActionHuleXueZhanMid: (action) => this.handleXuezhanHule(action, false),
    ActionHuleXueZhanEnd: (action) => this.handleXuezhanHule(action, true),
  };

  /**
   * In xuezhan the deal is not finished when it arrives: the round only starts
   * once the three-tile swap has been applied, so it is held here until then.
   */
  private pendingDeal: ActionPayload | null = null;

  public get gameEnded(): boolean {
    return this.state.gameEnded;
  }

  public reset() {
    this.state.reset();
    this.pendingDeal = null;
  }

  /**
   * Turns one captured frame into mjai events. `source` names the capture path
   * that saw it (`CDP` or `MITM`) and only shows up in the verbose capture log.
   */
  public parse(content: Buffer, source?: string): BridgeOutput {
    try {
      this.replayed = false;
      const parsed = this.liqiProto.parse(content);
      const isHeartbeat =
        parsed.kind === 'message' && parsed.message.method === MAJSOUL_METHODS.heartbeat;

      // The frame's own bytes, one level deeper than the decoded line: what a
      // decode this build gets wrong needs to reproduce. The keep-alive stays out
      // of both, and a frame that failed to decode still leaves its bytes behind.
      if (!isHeartbeat) {
        logger.debug(`${source ? `[${source}] ` : ''}raw ${content.toString('hex')}`);
      }

      if (parsed.kind === 'skipped') {
        return { events: [], replayed: this.replayed };
      }
      if (parsed.kind === 'failed') {
        return { events: [], parseFailed: true, replayed: this.replayed };
      }

      const liqiMessage = parsed.message;
      // The complete decoded message: a capture kept at `verbose` is what makes
      // a real game inspectable offline, and every field is logged as decoded.
      if (!isHeartbeat) {
        const tag = source ? `[${source}] ` : '';
        logger.verbose(
          `${tag}${liqiMessage.method} ${MsgType[liqiMessage.type]}`,
          liqiMessage.data,
        );
      }

      const events = this.parseLiqi(liqiMessage);
      return { events, replayed: this.replayed };
    } catch (e) {
      logger.error(`Error parsing Majsoul message: ${errorMessage(e)}`);
      return { events: [], parseFailed: true, replayed: this.replayed };
    }
  }

  // ===== liqi method dispatch =====

  private parseLiqi(liqiMessage: LiqiMessage): MJAIEvent[] {
    const { method, type } = liqiMessage;

    switch (method) {
      case MAJSOUL_METHODS.syncGame:
      case MAJSOUL_METHODS.enterGame:
        return type === MsgType.Res ? this.replayRestore(liqiMessage) : [];
      case MAJSOUL_METHODS.authGame:
        return this.handleAuthGame(liqiMessage, type);
      case MAJSOUL_METHODS.actionPrototype:
        return this.handleActionPrototype(liqiMessage);
      case MAJSOUL_METHODS.gameEndResult:
      case MAJSOUL_METHODS.gameTerminate:
        return this.handleGameEnd();
      default:
        return [];
    }
  }

  private handleAuthGame(liqiMessage: LiqiMessage, msgType: MsgType): MJAIEvent[] {
    if (msgType === MsgType.Req) {
      // The request only carries our account id; the real state arrives with the response.
      this.reset();
      this.state.accountId = (liqiMessage.data as ActionPayload).accountId as number;
      return [];
    }

    if (msgType === MsgType.Res) {
      const data = liqiMessage.data as ActionPayload;
      const seatList = data.seatList as number[];
      this.state.is3p = seatList.length === MahjongConstants.SEATS_3P;
      this.state.seat = seatList.indexOf(this.state.accountId);
      this.state.isXuezhan = isXuezhanRule(data.gameConfig);
      return [this.makeStartGame(this.state.seat, this.state.is3p)];
    }

    return [];
  }

  // ===== ActionPrototype handling =====

  private handleActionPrototype(liqiMessage: LiqiMessage): MJAIEvent[] {
    const action = liqiMessage.data as ActionPrototype;
    this.dropUnswappedDeal(action.name);

    // A riichi declared with the previous discard is accepted unless this action
    // is a ron on it, which voids the declaration and its deposit.
    const events: MJAIEvent[] = [];
    this.flushPendingReachAccepted(events, this.settlesByRon(action));

    if (END_ROUND_ACTIONS.has(action.name)) {
      events.push(...this.settlementEvents(action), this.makeEndKyoku());
      return events;
    }

    const handler = this.actionHandlers[action.name];
    if (!handler) {
      // Recorded at the capture level, so a survey of a log can tell which
      // actions the bridge has no mapping for.
      logger.verbose(`Unhandled ActionPrototype: ${action.name}`);
    }

    if (handler) events.push(...handler(action));
    events.push(...this.handleDoraUpdate(action));
    return events;
  }

  /**
   * Whether the action is a ron, which is the one way a round can move on that
   * voids a riichi declared with the discard before it: nobody pays the deposit
   * and the declaration never stands. A triple ron aborts the hand the same way.
   */
  private settlesByRon(action: ActionPrototype): boolean {
    if (action.name === 'ActionLiuJu') return action.data.type === LIUJU_THREE_RONS;
    if (!action.name.includes('Hule')) return false;

    return this.readWins(action).some((win) => !win.zimo);
  }

  /**
   * What the table settled before the round closed. Without it the three ways a
   * round can end -- a win, an exhaustive draw and an abortive draw -- are
   * indistinguishable in the event stream, since `end_kyoku` carries nothing.
   */
  private settlementEvents(action: ActionPrototype): MJAIEvent[] {
    switch (action.name) {
      case 'ActionHule':
        // `scores` is the table after the win: `oldScores + deltaScores` equals
        // it in every capture, including the plain four-player one
        // (`logs/akagi_20261019_130714.log`) that settled the question.
        return this.horaEvents(action, (action.data.scores as number[] | undefined) ?? []);
      case 'ActionNoTile':
        return this.handleNoTile(action);
      case 'ActionLiuJu':
        return this.handleLiuJu(action);
      default:
        return [];
    }
  }

  /** The reason strings `riichienv` gives the same aborts. */
  private static readonly LIUJU_REASONS: Record<number, string> = {
    1: 'kyushu_kyuhai',
    2: 'sufuurenta',
    3: 'suukansansen',
    4: 'suucha_riichi',
    5: 'sanchaho',
  };

  /**
   * An abortive draw: the hand never finished, so there is nothing to pay out.
   * `type` is a bare number in `liqi.proto`; the meanings are the ones the game's
   * other protocol readers agree on, in the order the game numbers them.
   *
   * Some types also reveal hands -- nine terminals shows the declarer's, four
   * riichi shows every seat, and a triple ron leaves out the discarder -- but the
   * event's `tehais` slot is not filled: the wire format of those strings has not
   * been seen in a capture, and `riichienv` does not read the field.
   */
  private handleLiuJu(action: ActionPrototype): MJAIEvent[] {
    const type = action.data.type as number | undefined;
    const reason = type === undefined ? undefined : MajsoulBridge.LIUJU_REASONS[type];
    if (type !== undefined && reason === undefined) {
      logger.warn(`Unknown ActionLiuJu type ${type}`);
    }

    return [this.makeRyukyoku([], [], [], reason)];
  }

  /**
   * One `hora` per win the settlement reports. A ron is charged to whoever
   * discarded last; a self-draw has no target.
   */
  private horaEvents(action: ActionPrototype, scores: number[]): MJAIEvent[] {
    const deltas = (action.data.deltaScores as number[] | undefined) ?? [];

    return this.readWins(action).map((win) => {
      if (!win.zimo && this.state.lastDiscard === null) {
        logger.warn(`Ron in ${action.name} without a discard to attribute it to`);
      }
      const target = win.zimo ? win.seat : (this.state.lastDiscard ?? win.seat);

      return this.makeHora(win.seat, target, toMjaiTile(win.pai), scores, deltas);
    });
  }

  /**
   * The wins a settlement names, in the order the table lists them. A blood
   * battle repeats the round's earlier wins in `hulesHistory`, which the Mid
   * events already reported, so only `hules` is read.
   */
  private readWins(action: ActionPrototype): { seat: number; pai: string; zimo: boolean }[] {
    const hules = (action.data.hules as ActionPayload[] | undefined) ?? [];

    return hules.map((hule) => ({
      seat: hule.seat as number,
      pai: hule.huTile as string,
      zimo: hule.zimo === true,
    }));
  }

  /**
   * Majsoul fuses the riichi declaration and the discard, so the accepted event
   * is held back until the next action proves the declaration stood. A ron on
   * that discard is the exception: the deposit is never paid, so the held event
   * is dropped instead of reported.
   */
  private flushPendingReachAccepted(events: MJAIEvent[], ronned = false) {
    const accepted = this.state.pendingReachAccepted;
    if (!accepted) return;

    this.state.pendingReachAccepted = null;
    if (!ronned) events.push(accepted);
  }

  /**
   * A held deal is completed by the swap that follows it, and by nothing else.
   * If a round-level action arrives first the swap never came, and keeping the
   * deal would leave the round unopened for the rest of the game.
   */
  private dropUnswappedDeal(actionName: string) {
    if (!this.pendingDeal || !STALE_DEAL_ACTIONS.has(actionName)) return;

    logger.warn(`Dropping a dealt round that never swapped (${actionName} arrived first)`);
    this.pendingDeal = null;
  }

  private handleNewRound(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;

    // Xuezhan deals before the swap, so the round cannot open yet: the hand is
    // still going to lose three tiles and gain three. `handleChangeTile` opens it.
    if (this.state.isXuezhan) {
      this.pendingDeal = data;
      return [];
    }

    return this.openRound(data, toMjaiTileOrUnknown(data.doras as string[]));
  }

  /**
   * Opens the round from a deal whose hand is final: the plain deal, or a
   * xuezhan deal with its swap already applied.
   */
  private openRound(data: ActionPayload, doraMarker: string): MJAIEvent[] {
    const bakaze = ROUND_WINDS[data.chang as number];
    this.state.doras = doraMarker === MahjongConstants.UNKNOWN_TILE ? [] : [doraMarker];

    const honba = data.ben as number;
    const oya = data.ju as number;
    const kyoku = oya + 1;
    const kyotaku = data.liqibang as number;
    let scores = data.scores as number[];
    if (this.state.is3p) {
      scores = [...scores, 0];
    }

    const round = this.state.setupNewRound(data.tiles as string[]);
    if (!round) return [];

    const events: MJAIEvent[] = [
      this.makeStartKyoku(bakaze, kyoku, honba, kyotaku, oya, doraMarker, scores, round.tehais),
    ];

    if (round.myTsumohai) {
      events.push(this.makeTsumo(this.state.seat, round.myTsumohai));
    }

    return events;
  }

  /**
   * The three-tile swap that opens every xuezhan round. The hand it reports is
   * not complete (the payload only lists what moved), so the held deal is
   * corrected here — tiles leave, tiles arrive — and only then does the round
   * open together with the dora indicator the swap carries.
   */
  private handleChangeTile(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const deal = this.pendingDeal;
    this.pendingDeal = null;

    if (!deal) return [];

    const out = (data.outTiles as string[] | undefined) ?? [];
    const incoming = (data.inTiles as string[] | undefined) ?? [];
    const { hand, missing } = applySwap(deal.tiles as string[], out, incoming);
    if (missing.length > 0)
      logger.warn(`Swapped-out tiles missing from the deal: ${missing.join(', ')}`);

    logger.verbose(`Xuezhan swap: out ${out.join('+') || '-'}, in ${incoming.join('+') || '-'}`);

    return this.openRound({ ...deal, tiles: hand }, toMjaiTileOrUnknown(data.doras as string[]));
  }

  /**
   * A win in a blood battle. It settles immediately, but unlike `ActionHule` it
   * does not end the round: the players who have already won stop drawing and
   * the rest carry on. Only the third win ends it (`ActionHuleXueZhanEnd`).
   */
  private handleXuezhanHule(action: ActionPrototype, endsRound: boolean): MJAIEvent[] {
    const scores = (action.data.scores as number[] | undefined) ?? [];
    // The final win's `hulesHistory` repeats what the Mid events already
    // reported, so only `hules` is converted.
    const events = this.horaEvents(action, scores);

    if (endsRound) events.push(this.makeEndKyoku());

    return events;
  }

  /**
   * An exhaustive draw. The payments come from the game because a mode may
   * exclude players (a blood battle does not charge or pay those who already
   * won), and `tenpais` reports only the players who were actually paid.
   */
  private handleNoTile(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const players = (data.players as ActionPayload[] | undefined) ?? [];
    const settlement = ((data.scores as ActionPayload[] | undefined)?.[0] ?? {}) as ActionPayload;
    const deltas = (settlement.deltaScores as number[] | undefined) ?? [];
    const before = (settlement.oldScores as number[] | undefined) ?? [];
    // The payload reports the table before the draw and the change; the event
    // reports it after, as a win does. Verified against every capture: the sum
    // matches the next round's opening scores.
    const scores = before.map((value, seat) => value + (deltas[seat] ?? 0));
    const tenpais = players.map((player) => player.tingpai === true && player.alreadyHule !== true);
    // A nagashi mangan pays like a win, so a plain exhaustive draw is not the
    // only thing this action can report.
    const reason = data.liujumanguan === true ? 'nagashimangan' : 'exhaustive_draw';

    return [this.makeRyukyoku(scores, deltas, tenpais, reason)];
  }

  private handleDealTile(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const actor = data.seat as number;

    let pai: string = MahjongConstants.UNKNOWN_TILE;
    if (data.tile) {
      pai = toMjaiTile(data.tile as string);
      if (actor === this.state.seat) {
        this.state.myTsumohai = pai;
      }
    }

    return [this.makeTsumo(actor, pai)];
  }

  private handleDiscardTile(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const actor = data.seat as number;
    this.state.lastDiscard = actor;

    const pai = toMjaiTile(data.tile as string);
    const tsumogiri = data.moqie as boolean;

    const events: MJAIEvent[] = [];
    if (data.isLiqi) {
      events.push(this.makeReach(actor));
    }
    events.push(this.makeDahai(actor, pai, tsumogiri));

    this.state.onDiscard(actor, pai, tsumogiri);

    if (data.isLiqi) {
      // Majsoul fuses the riichi declaration and the discard, and only the next
      // action can prove nobody ronned it, so the acceptance is held until then.
      this.state.pendingReachAccepted = this.makeReachAccepted(actor);
    }

    return events;
  }

  private handleChiPengGang(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const actor = data.seat as number;
    const froms = data.froms as number[];
    const tiles = data.tiles as string[];

    let target = actor;
    let pai = '';
    const consumed: string[] = [];

    for (let idx = 0; idx < froms.length; idx++) {
      const seat = froms[idx];
      if (seat === actor) {
        consumed.push(toMjaiTile(tiles[idx]));
      } else {
        target = seat;
        pai = toMjaiTile(tiles[idx]);
      }
    }

    if (target === actor || consumed.length === 0 || !pai) {
      throw new Error(
        `Invalid Chi/Peng/Gang format: target=${target}, consumed=${consumed}, pai='${pai}'`,
      );
    }

    this.state.onOpenMeld(actor, consumed);

    switch (data.type) {
      case OperationChiPengGang.Chi:
        if (consumed.length !== MELD_TILES.chi) {
          throw new Error('Invalid consumed count');
        }
        return [this.makeChi(actor, target, pai, consumed)];
      case OperationChiPengGang.Peng:
        if (consumed.length !== MELD_TILES.pon) {
          throw new Error('Invalid consumed count');
        }
        return [this.makePon(actor, target, pai, consumed)];
      case OperationChiPengGang.Gang:
        if (consumed.length !== MELD_TILES.daiminkan) {
          throw new Error('Invalid consumed count');
        }
        return [this.makeDaiminkan(actor, target, pai, consumed)];
      default:
        logger.error(`Unknown ActionChiPengGang type: ${data.type as number}`);
        return [];
    }
  }

  private handleAnGangAddGang(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const actor = data.seat as number;
    const pai = toMjaiTile(data.tiles as string);

    switch (data.type) {
      case OperationAnGangAddGang.AnGang: {
        const consumed = this.buildKanTiles(pai, 'closed');
        this.state.onKan(actor, consumed, false);
        return [this.makeAnkan(actor, consumed)];
      }
      case OperationAnGangAddGang.AddGang: {
        const consumed = this.buildKanTiles(pai, 'added');
        this.state.onKan(actor, consumed, true, pai);
        return [this.makeKakan(actor, pai, consumed)];
      }
      default:
        return [];
    }
  }

  /**
   * The tiles a kan consumes, with the red-five flag kept on the first copy.
   *
   * A closed kan takes all its tiles from the hand, so a declared suit five
   * (red or not) means a red copy is assumed present. An added kan's consumed
   * list is the pon already on the table while `pai` is the tile just added, so
   * a red `pai` is not part of it.
   */
  private buildKanTiles(pai: string, kind: 'closed' | 'added'): string[] {
    const count = kind === 'closed' ? MELD_TILES.ankan : MELD_TILES.kakan;
    const consumed = Array<string>(count).fill(pai.replace('r', ''));
    const carriesRed = isSuitFive(pai) && (kind === 'closed' || !isRedFive(pai));
    if (carriesRed) consumed[0] += 'r';
    return consumed;
  }

  private handleBaBei(action: ActionPrototype): MJAIEvent[] {
    const data = action.data;
    const actor = data.seat as number;
    this.state.onNukidora(actor);
    return [this.makeNukidora(actor)];
  }

  private handleDoraUpdate(action: ActionPrototype): MJAIEvent[] {
    const doras = action.data.doras as string[] | undefined;

    if (doras && doras.length > this.state.doras.length) {
      this.state.doras = doras;
      return [this.makeDora(toMjaiTile(doras[doras.length - 1]))];
    }

    return [];
  }

  private handleGameEnd(): MJAIEvent[] {
    this.state.gameEnded = true;
    return [this.makeEndGame()];
  }

  // ===== Reconnect / restore replay =====

  /**
   * Both `syncGame` and `enterGame` answer a reconnect with a `game_restore`
   * whose `actions[]` is the whole kyoku so far, and replaying it through the
   * normal per-action path is what rebuilds the state a restarted app would
   * otherwise have lost. Entering a table carries no restore until the client is
   * actually mid-match, so an empty one has to be a no-op.
   */
  private replayRestore(liqiMessage: LiqiMessage): MJAIEvent[] {
    this.applySnapshotMode(liqiMessage);

    const actions = parseSyncGameActions(liqiMessage, this.liqiProto);
    // Only a frame that actually replayed history is a replay: a fresh-table
    // `enterGame` restores nothing and the session status would be wrong to say
    // it did.
    this.replayed = actions.length > 0;

    const events: MJAIEvent[] = [];
    for (const action of actions) {
      events.push(...this.handleActionPrototype(action));
    }

    return events;
  }

  private applySnapshotMode(liqiMessage: LiqiMessage) {
    const is3p = is3pFromSyncSnapshot(liqiMessage);
    if (is3p !== null) this.state.is3p = is3p;
  }
}
