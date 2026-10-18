import { createLogger } from '../../logging/index.js';
import { MahjongConstants } from '../../shared/schema/mahjong.js';
import type { MJAIEvent } from '../../shared/schema/mjai.js';
import type { BridgeOutput } from '../base-bridge.js';
import { BaseBridge } from '../base-bridge.js';
import { OperationAnGangAddGang, OperationChiPengGang } from './consts.js';
import type { LiqiMessage } from './liqi.js';
import { LiqiProto, MsgType } from './liqi.js';
import { MajsoulStateTracker } from './state-tracker.js';
import { is3pFromSyncSnapshot, parseSyncGameActions } from './sync-replay.js';
import { toMjaiTile } from './tile-mapping.js';
import { applySwap, isXuezhanRule, parseXuezhanWins } from './xuezhan.js';

const logger = createLogger('MajsoulBridge');

/** Decoded fields of one protocol message; its shape is only known at runtime. */
type ActionPayload = Record<string, unknown>;

/** An `ActionPrototype` frame: the action's name plus its own decoded payload. */
interface ActionPrototype extends ActionPayload {
  name: string;
  data: ActionPayload;
}

/** `chang` (the round-wind index) to the mjai round-wind tile. */
const ROUND_WINDS = ['E', 'S', 'W', 'N'] as const;

/** ActionPrototype names that end the current kyoku. */
const END_ROUND_ACTIONS = new Set(['ActionHule', 'ActionNoTile', 'ActionLiuJu']);

/** Round-level actions that mean a swap will never arrive for a held deal. */
const STALE_DEAL_ACTIONS = new Set([
  ...END_ROUND_ACTIONS,
  'ActionNewRound',
  'ActionHuleXueZhanMid',
  'ActionHuleXueZhanEnd',
]);

/**
 * The game websocket's keep-alive. It carries no game state and arrives as a
 * Req/Res pair every few seconds, which at one capture line per frame would
 * drown the game itself, so it is decoded but not recorded.
 */
const HEARTBEAT_METHOD = '.lq.Route.heartbeat';

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

  public override reset() {
    super.reset();
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
      const isHeartbeat = parsed.kind === 'message' && parsed.message.method === HEARTBEAT_METHOD;

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
      logger.error(`Error parsing Majsoul message: ${e instanceof Error ? e.message : String(e)}`);
      return { events: [], parseFailed: true, replayed: this.replayed };
    }
  }

  // ===== liqi method dispatch =====

  private parseLiqi(liqiMessage: LiqiMessage): MJAIEvent[] {
    const { method, type } = liqiMessage;

    switch (method) {
      case '.lq.FastTest.syncGame':
        return type === MsgType.Res ? this.parseSyncGame(liqiMessage) : [];
      case '.lq.FastTest.enterGame':
        return type === MsgType.Res ? this.parseEnterGame(liqiMessage) : [];
      case '.lq.FastTest.authGame':
        return this.handleAuthGame(liqiMessage, type);
      case '.lq.ActionPrototype':
        return this.handleActionPrototype(liqiMessage);
      case '.lq.NotifyGameEndResult':
      case '.lq.NotifyGameTerminate':
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

    // A round-ending action settles and ends the kyoku; the held reach_accepted
    // is deliberately dropped, because a round that ends here never accepted it.
    if (END_ROUND_ACTIONS.has(action.name)) return this.roundEndEvents(action);

    const handler = this.actionHandlers[action.name];
    if (!handler) {
      // Recorded at the capture level, so a survey of a log can tell which
      // actions the bridge has no mapping for.
      logger.verbose(`Unhandled ActionPrototype: ${action.name}`);
    }

    const events = handler ? handler(action) : [];
    this.flushPendingReachAccepted(events);
    events.push(...this.handleDoraUpdate(action));
    return events;
  }

  /** The mode's own settlement (if any), then the round's end. */
  private roundEndEvents(action: ActionPrototype): MJAIEvent[] {
    const settlement = action.name === 'ActionNoTile' ? this.handleNoTile(action) : [];
    return [...settlement, this.makeEndKyoku()];
  }

  /**
   * Majsoul fuses the riichi declaration and the discard, so the accepted event
   * is held back and appended after the next action has been reported.
   */
  private flushPendingReachAccepted(events: MJAIEvent[]) {
    const accepted = this.state.pendingReachAccepted;
    if (!accepted) return;

    events.push(accepted);
    this.state.pendingReachAccepted = null;
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
    const data = action.data;
    const scores = (data.scores as number[] | undefined) ?? [];
    const deltas = (data.deltaScores as number[] | undefined) ?? [];
    const events: MJAIEvent[] = [];

    for (const win of parseXuezhanWins(data)) {
      // A ron is charged to whoever discarded last; a self-draw has no target.
      if (!win.zimo && this.state.lastDiscard === null) {
        logger.warn('Xuezhan ron without a discard to attribute it to');
      }
      const target = win.zimo ? win.seat : (this.state.lastDiscard ?? win.seat);
      events.push(this.makeHora(win.seat, target, toMjaiTile(win.pai), scores, deltas));
    }

    // The final win ends the round. Its `hulesHistory` repeats what the Mid
    // events already reported, so it is not converted again.
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
    const scores = (settlement.oldScores as number[] | undefined) ?? [];
    const tenpais = players.map((player) => player.tingpai === true && player.alreadyHule !== true);

    return [this.makeRyukyoku(scores, deltas, tenpais)];
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
      // Majsoul fuses the riichi declaration and the discard; the accepted
      // event is appended after the discard has been reported.
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
        if (consumed.length !== MahjongConstants.CHI_CONSUMED) {
          throw new Error('Invalid consumed count');
        }
        return [this.makeChi(actor, target, pai, consumed)];
      case OperationChiPengGang.Peng:
        if (consumed.length !== MahjongConstants.PON_CONSUMED) {
          throw new Error('Invalid consumed count');
        }
        return [this.makePon(actor, target, pai, consumed)];
      case OperationChiPengGang.Gang:
        if (consumed.length !== MahjongConstants.DAIMINKAN_CONSUMED) {
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
    const count =
      kind === 'closed' ? MahjongConstants.ANKAN_TILES : MahjongConstants.KAKAN_CONSUMED;
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

  // ===== Reconnect / sync replay =====

  private parseSyncGame(liqiMessage: LiqiMessage): MJAIEvent[] {
    this.applySnapshotMode(liqiMessage);

    const syncGameMsgs = parseSyncGameActions(liqiMessage, this.liqiProto);
    const parsedList: MJAIEvent[] = [];
    this.replayed = true;

    try {
      for (let i = 0; i < syncGameMsgs.length; i++) {
        // The last replayed frame is not historical: it is the state the game is
        // in now, so it must be allowed to produce a recommendation.
        this.syncing = i !== syncGameMsgs.length - 1;
        parsedList.push(...this.handleActionPrototype(syncGameMsgs[i]));
      }
    } finally {
      this.syncing = false;
    }

    return parsedList;
  }

  private parseEnterGame(liqiMessage: LiqiMessage): MJAIEvent[] {
    this.syncing = false;
    this.applySnapshotMode(liqiMessage);

    const parsedList: MJAIEvent[] = [];
    for (const msg of parseSyncGameActions(liqiMessage, this.liqiProto)) {
      parsedList.push(...this.handleActionPrototype(msg));
    }

    return parsedList;
  }

  private applySnapshotMode(liqiMessage: LiqiMessage) {
    const is3p = is3pFromSyncSnapshot(liqiMessage);
    if (is3p !== null) this.state.is3p = is3p;
  }
}
