import { createLogger } from '../../logging/index.js';
import { MahjongConstants } from '../../shared/schema/mahjong.js';
import type { MJAIEvent } from '../../shared/schema/mjai.js';
import type { BridgeOutput } from '../base-bridge.js';
import { BaseBridge } from '../base-bridge.js';
import { OperationAnGangAddGang, OperationChiPengGang } from './consts.js';
import type { LiqiMessage } from './liqi.js';
import { LiqiProto, MsgType } from './liqi.js';
import { MajsoulStateTracker } from './state-tracker.js';
import { toMjaiTile } from './tile-mapping.js';

const logger = createLogger('MajsoulBridge');

type ActionPayload = Record<string, unknown>;

/** ActionPrototype names that end the current kyoku. */
const END_ROUND_ACTIONS = new Set(['ActionHule', 'ActionNoTile', 'ActionLiuJu']);

/**
 * The game websocket's keep-alive. It carries no game state and arrives as a
 * Req/Res pair every few seconds, which at one capture line per frame would
 * drown the game itself, so it is decoded but not recorded.
 */
const HEARTBEAT_METHOD = '.lq.Route.heartbeat';

export class MajsoulBridge extends BaseBridge {
  public readonly liqiProto: LiqiProto = new LiqiProto();
  private readonly state = new MajsoulStateTracker();
  /** Set while the frame being parsed is a reconnect replay. */
  private replayed = false;

  private readonly actionHandlers: Readonly<
    Record<string, (actionData: ActionPayload) => MJAIEvent[]>
  > = {
    ActionNewRound: (actionData) => this.handleNewRound(actionData),
    ActionDealTile: (actionData) => this.handleDealTile(actionData),
    ActionDiscardTile: (actionData) => this.handleDiscardTile(actionData),
    ActionChiPengGang: (actionData) => this.handleChiPengGang(actionData),
    ActionAnGangAddGang: (actionData) => this.handleAnGangAddGang(actionData),
    ActionBaBei: (actionData) => this.handleBaBei(actionData),
  };

  public get gameEnded(): boolean {
    return this.state.gameEnded;
  }

  public override reset() {
    super.reset();
    this.state.reset();
  }

  /**
   * Turns one captured frame into mjai events. `source` names the capture path
   * that saw it (`CDP` or `MITM`) and only shows up in the verbose capture log.
   */
  public parse(content: Buffer, source?: string): BridgeOutput {
    try {
      this.replayed = false;
      const liqiMessage = this.liqiProto.parse(content);
      if (!liqiMessage) return { events: [], replayed: this.replayed };

      // The complete decoded message: a capture kept at `verbose` is what makes
      // a real game inspectable offline, and every field is logged as decoded.
      if (liqiMessage.method !== HEARTBEAT_METHOD) {
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
      return [this.makeStartGame(this.state.seat, this.state.is3p)];
    }

    return [];
  }

  // ===== ActionPrototype handling =====

  private handleActionPrototype(liqiMessage: LiqiMessage): MJAIEvent[] {
    const actionData = liqiMessage.data as ActionPayload;
    const actionName = actionData.name as string;

    if (END_ROUND_ACTIONS.has(actionName)) {
      return [this.makeEndKyoku()];
    }

    const handler = this.actionHandlers[actionName];
    if (!handler) {
      logger.debug(`Unhandled ActionPrototype: ${actionName}`);
    }

    const events = handler ? handler(actionData) : [];

    if (this.state.pendingReachAccepted) {
      events.push(this.state.pendingReachAccepted);
      this.state.pendingReachAccepted = null;
    }

    events.push(...this.handleDoraUpdate(actionData));
    return events;
  }

  private handleNewRound(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
    const bakaze = ['E', 'S', 'W', 'N'][data.chang as number];
    const doraMarker = toMjaiTile((data.doras as string[])[0]);
    this.state.doras = [doraMarker];

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

  private handleDealTile(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
    const actor = data.seat as number;

    let pai = '?';
    if (data.tile) {
      pai = toMjaiTile(data.tile as string);
      if (actor === this.state.seat) {
        this.state.myTsumohai = pai;
      }
    }

    return [this.makeTsumo(actor, pai)];
  }

  private handleDiscardTile(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
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

  private handleChiPengGang(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
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

  private handleAnGangAddGang(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
    const actor = data.seat as number;
    const pai = toMjaiTile(data.tiles as string);

    switch (data.type) {
      case OperationAnGangAddGang.AnGang: {
        const consumed = this.buildAnkanTiles(pai);
        this.state.onKan(actor, consumed, false);
        return [this.makeAnkan(actor, consumed)];
      }
      case OperationAnGangAddGang.AddGang: {
        const consumed = Array<string>(MahjongConstants.KAKAN_CONSUMED).fill(pai.replace('r', ''));
        if (pai[0] === '5' && !pai.endsWith('r')) {
          consumed[0] += 'r';
        }
        this.state.onKan(actor, consumed, true, pai);
        return [this.makeKakan(actor, pai, consumed)];
      }
      default:
        return [];
    }
  }

  /**
   * A closed kan always consumes the other three copies of the tile; the hand
   * may hold a red five instead of a plain one, so the first entry keeps the
   * red flag to mirror the legacy conversion.
   */
  private buildAnkanTiles(pai: string): string[] {
    const consumed = Array<string>(MahjongConstants.ANKAN_TILES).fill(pai.replace('r', ''));
    if (pai[0] === '5' && pai[1] !== 'z') {
      consumed[0] += 'r';
    }
    return consumed;
  }

  private handleBaBei(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload;
    const actor = data.seat as number;
    this.state.onNukidora(actor);
    return [this.makeNukidora(actor)];
  }

  private handleDoraUpdate(actionData: ActionPayload): MJAIEvent[] {
    const data = actionData.data as ActionPayload | undefined;
    const doras = data?.doras as string[] | undefined;

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
    this.preScanModeFromSyncMsg(liqiMessage);

    const syncGameMsgs = this.parseSyncGameRaw(liqiMessage);
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
    this.preScanModeFromSyncMsg(liqiMessage);

    const parsedList: MJAIEvent[] = [];
    for (const msg of this.parseSyncGameRaw(liqiMessage)) {
      parsedList.push(...this.handleActionPrototype(msg));
    }

    return parsedList;
  }

  /** The game mode is only known from the snapshot before actions are replayed. */
  private preScanModeFromSyncMsg(liqiMessage: LiqiMessage) {
    const data = liqiMessage.data as ActionPayload | undefined;
    const gameRestore = data?.gameRestore as ActionPayload | undefined;
    const snapshot = gameRestore?.snapshot as ActionPayload | undefined;
    const players = snapshot?.players as unknown[] | undefined;

    if (players) {
      this.state.is3p = players.length === MahjongConstants.SEATS_3P;
      logger.debug(`Pre-scanned mode from snapshot: is_3p=${this.state.is3p}`);
    }
  }

  /**
   * Unpacks the base64 action history of `gameRestore` into ActionPrototype
   * shaped messages so they can be replayed through the normal handlers.
   */
  private parseSyncGameRaw(liqiMessage: LiqiMessage): LiqiMessage[] {
    const messages: LiqiMessage[] = [];

    try {
      const data = liqiMessage.data as ActionPayload | undefined;
      const restore = data?.gameRestore as ActionPayload | undefined;
      if (!restore) return [];

      const actions = (restore.actions ?? []) as ActionPayload[];
      for (const action of actions) {
        const item = this.parseSyncGameActionItem(action);
        if (item) messages.push(item);
      }
    } catch (e) {
      logger.error(`Error parsing sync game: ${e instanceof Error ? e.message : String(e)}`);
    }

    return messages;
  }

  private parseSyncGameActionItem(actionDict: ActionPayload): LiqiMessage | null {
    const innerName = actionDict.name as string;
    const rawData = Buffer.from(actionDict.data as string, 'base64');
    const innerDict = this.liqiProto.parseWrapper(innerName, rawData, false);

    if (!innerDict) return null;

    return {
      id: -1,
      type: MsgType.Notify,
      method: '.lq.ActionPrototype',
      data: { ...actionDict, data: innerDict },
    };
  }
}
