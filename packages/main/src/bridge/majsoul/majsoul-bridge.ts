import { createLogger } from '../../logger.js';
import { MahjongConstants } from '../../schema/constants.js';
import type { AkagiEvent, ReachAcceptedEvent } from '../../schema/mjai.js';
import { NotificationCode } from '../../schema/mjai.js';
import { BaseBridge } from '../base.js';
import { OperationAnGangAddGang, OperationChiPengGang } from './consts.js';
import type { LiqiMessage } from './liqi.js';
import { LiqiProto, MsgType } from './liqi.js';
import { comparePai, MS_TILE_2_MJAI_TILE } from './tile-mapping.js';

const logger = createLogger('MajsoulBridge');

export class MajsoulBridge extends BaseBridge {
  public liqiProto: LiqiProto;

  public accountId: number = 0;
  public seat: number = 0;
  public lastDiscard: number | null = null;
  public reach: boolean = false;
  public acceptReach: ReachAcceptedEvent | null = null;
  public doras: string[] = [];
  public myTehais: string[] = Array(MahjongConstants.TEHAI_SIZE).fill('?');
  public myTsumohai: string | null = '?';
  public syncing: boolean = false;

  public modeId: number = -1;
  public rank: number = -1;
  public score: number = -1;

  public is3p: boolean = false;
  public gameEnded: boolean = false;

  constructor() {
    super();
    this.liqiProto = new LiqiProto();
    this.initState();
  }

  private initState() {
    this.accountId = 0;
    this.seat = 0;
    this.lastDiscard = null;
    this.reach = false;
    this.acceptReach = null;
    this.doras = [];
    this.myTehais = Array(MahjongConstants.TEHAI_SIZE).fill('?');
    this.myTsumohai = '?';
    this.syncing = false;

    this.modeId = -1;
    this.rank = -1;
    this.score = -1;

    this.is3p = false;
    this.gameEnded = false;
  }

  public override reset() {
    super.reset();
    this.initState();
  }

  public parse(content: Buffer): AkagiEvent[] {
    try {
      const liqiMessage = this.liqiProto.parse(content);
      if (!liqiMessage) return [];
      const parsed = this.parseLiqi(liqiMessage);

      // We might want to log trace level info later
      return parsed;
    } catch (e) {
      logger.error(`Error parsing Majsoul message: ${e instanceof Error ? e.message : String(e)}`);
      return [this.makeSystemEvent(NotificationCode.PARSE_ERROR)];
    }
  }

  private parseSyncGame(liqiMessage: LiqiMessage): AkagiEvent[] {
    this.preScanModeFromSyncMsg(liqiMessage);

    const syncGameMsgs = this.parseSyncGameRaw(liqiMessage);
    const parsedList: AkagiEvent[] = [this.makeSystemEvent(NotificationCode.GAME_SYNCING)];

    try {
      for (let i = 0; i < syncGameMsgs.length; i++) {
        const isLastMsg = i === syncGameMsgs.length - 1;
        this.syncing = !isLastMsg;
        const parsed = this.handleActionPrototype(syncGameMsgs[i]);
        if (parsed.length > 0) {
          parsedList.push(...parsed);
        }
      }
    } finally {
      this.syncing = false;
    }

    return parsedList;
  }

  private parseEnterGame(liqiMessage: LiqiMessage): AkagiEvent[] {
    this.syncing = false;
    this.preScanModeFromSyncMsg(liqiMessage);

    const syncGameMsgs = this.parseSyncGameRaw(liqiMessage);
    const parsedList: AkagiEvent[] = [];

    for (const msg of syncGameMsgs) {
      const parsed = this.handleActionPrototype(msg);
      if (parsed.length > 0) {
        parsedList.push(...parsed);
      }
    }

    return parsedList;
  }

  private preScanModeFromSyncMsg(msgDict: LiqiMessage) {
    const data = msgDict.data as Record<string, unknown> | undefined;
    const gameRestore = data?.gameRestore as Record<string, unknown> | undefined;
    const snapshot = gameRestore?.snapshot as Record<string, unknown> | undefined;
    const players = snapshot?.players as unknown[] | undefined;
    if (players) {
      this.is3p = players.length === MahjongConstants.SEATS_3P;
      logger.debug(`Pre-scanned mode from snapshot: is_3p=${this.is3p}`);
    }
  }

  private parseSyncGameRaw(msgDict: LiqiMessage): LiqiMessage[] {
    const msgs: LiqiMessage[] = [];
    try {
      const data = msgDict?.data as Record<string, unknown> | undefined;
      const restore = data?.gameRestore as Record<string, unknown> | undefined;
      if (!restore) return [];

      const actions = (restore.actions || []) as Record<string, unknown>[];
      for (const action of actions) {
        const item = this.parseSyncGameActionItem(action);
        if (item) {
          msgs.push(item);
        }
      }
    } catch (e) {
      logger.error(`Error parsing sync game: ${e instanceof Error ? e.message : String(e)}`);
    }
    return msgs;
  }

  private parseSyncGameActionItem(actionDict: Record<string, unknown>): LiqiMessage | null {
    const innerName = actionDict.name as string;
    const rawData = Buffer.from(actionDict.data as string, 'base64');
    const innerDict = this.liqiProto.parseWrapper(innerName, rawData, false);

    if (!innerDict) return null;

    actionDict.data = innerDict;
    return {
      id: -1,
      type: MsgType.Notify,
      method: '.lq.ActionPrototype',
      data: actionDict,
    };
  }

  private parseAuthGameReq(liqiMessage: LiqiMessage): AkagiEvent[] {
    this.reset();
    const data = liqiMessage.data as Record<string, unknown>;
    this.accountId = data.accountId as number;
    return [];
  }

  private parseAuthGameRes(liqiMessage: LiqiMessage): AkagiEvent[] {
    const data = liqiMessage.data as Record<string, unknown>;
    const seatList = data.seatList as number[];
    this.is3p = seatList.length === MahjongConstants.SEATS_3P;
    try {
      const gameConfig = data.gameConfig as Record<string, unknown>;
      const meta = gameConfig.meta as Record<string, unknown>;
      this.modeId = meta.modeId as number;
    } catch {
      this.modeId = -1;
    }

    this.seat = seatList.indexOf(this.accountId);
    return [this.makeStartGame(this.seat, this.is3p)];
  }

  private setupNewRoundTehais(tiles: string[]): [string[][], string[], string | null] {
    const tehais = Array(MahjongConstants.SEATS_4P)
      .fill(null)
      .map(() => Array(MahjongConstants.TEHAI_SIZE).fill('?'));
    let myTehais = Array(MahjongConstants.TEHAI_SIZE).fill('?');
    let myTsumohai: string | null = null;

    for (let hai = 0; hai < MahjongConstants.TEHAI_SIZE; hai++) {
      myTehais[hai] = MS_TILE_2_MJAI_TILE[tiles[hai]];
    }

    if (tiles.length === MahjongConstants.TEHAI_SIZE) {
      const sortedTehais = [...myTehais].sort(comparePai);
      tehais[this.seat] = [...sortedTehais];
      myTehais = sortedTehais;
    } else if (tiles.length === MahjongConstants.TSUMO_TEHAI_SIZE) {
      const allTiles = [...myTehais, MS_TILE_2_MJAI_TILE[tiles[MahjongConstants.TEHAI_SIZE]]].sort(
        comparePai,
      );
      myTehais = allTiles.slice(0, MahjongConstants.TEHAI_SIZE);
      myTsumohai = allTiles[MahjongConstants.TEHAI_SIZE];
      tehais[this.seat] = [...myTehais];
    } else {
      logger.error(`Unexpected tile count in ActionNewRound: ${tiles.length}`);
      return [[], [], null];
    }

    return [tehais, myTehais, myTsumohai];
  }

  private handleActionNewRound(actionData: Record<string, unknown>): AkagiEvent[] {
    const ret: AkagiEvent[] = [];
    const data = actionData.data as Record<string, unknown>;
    const bakaze = ['E', 'S', 'W', 'N'][data.chang as number];
    const doras = data.doras as number[];
    const doraMarker = MS_TILE_2_MJAI_TILE[doras[0]];
    this.doras = [doraMarker];
    const honba = data.ben as number;
    const oya = data.ju as number;
    const kyoku = oya + 1;
    const kyotaku = data.liqibang as number;
    let scores = data.scores as number[];
    if (this.is3p) {
      scores = [...scores, 0];
    }

    const tiles = data.tiles as string[];
    const [tehais, myTehais, myTsumohai] = this.setupNewRoundTehais(tiles);
    if (tehais.length === 0) return [];

    this.myTehais = myTehais;
    this.myTsumohai = myTsumohai;

    ret.push(this.makeStartKyoku(bakaze, kyoku, honba, kyotaku, oya, doraMarker, scores, tehais));

    if (tiles.length === MahjongConstants.TSUMO_TEHAI_SIZE) {
      ret.push(this.makeTsumo(this.seat, this.myTsumohai as string));
    }

    return ret;
  }

  private saveTsumohaiToHand() {
    if (this.myTsumohai) {
      this.myTehais.push(this.myTsumohai);
      this.myTehais.sort(comparePai);
      this.myTsumohai = null;
    }
  }

  private removeTileFromHand(tile: string) {
    const exactIndex = this.myTehais.indexOf(tile);
    if (exactIndex !== -1) {
      this.myTehais.splice(exactIndex, 1);
      return;
    }

    const base = tile.replace('r', '');
    for (let i = 0; i < this.myTehais.length; i++) {
      if (this.myTehais[i].replace('r', '') === base) {
        this.myTehais.splice(i, 1);
        break;
      }
    }
  }

  private updateHandDiscard(actor: number, pai: string, tsumogiri: boolean) {
    if (actor !== this.seat) return;

    if (tsumogiri) {
      this.myTsumohai = null;
    } else {
      const idx = this.myTehais.indexOf(pai);
      if (idx !== -1) {
        this.myTehais.splice(idx, 1);
      } else if (this.myTsumohai === pai) {
        this.myTsumohai = null;
      } else {
        logger.warn(`Discarded tile ${pai} not found in hand ${this.myTehais}`);
      }
    }

    this.saveTsumohaiToHand();
  }

  private updateHandOpenMeld(actor: number, consumed: string[]) {
    if (actor !== this.seat) return;
    for (const t of consumed) {
      this.removeTileFromHand(t);
    }
  }

  private updateHandKan(actor: number, consumed: string[], isKakan: boolean, pai?: string) {
    if (actor !== this.seat) return;

    this.saveTsumohaiToHand();

    if (isKakan && pai) {
      this.removeTileFromHand(pai);
    } else if (!isKakan) {
      for (const tile of consumed) {
        this.removeTileFromHand(tile);
      }
    }
  }

  private handleActionChiPengGang(actionData: Record<string, unknown>): AkagiEvent[] {
    const data = actionData.data as Record<string, unknown>;
    const actor = data.seat as number;
    let target = actor;
    const consumed: string[] = [];
    let pai = '';
    const froms = data.froms as number[];
    const tiles = data.tiles as string[];

    for (let idx = 0; idx < froms.length; idx++) {
      const seat = froms[idx];
      if (seat !== actor) {
        target = seat;
        pai = MS_TILE_2_MJAI_TILE[tiles[idx]];
      } else {
        consumed.push(MS_TILE_2_MJAI_TILE[tiles[idx]]);
      }
    }

    if (target === actor || consumed.length === 0 || !pai) {
      throw new Error(
        `Invalid Chi/Peng/Gang format: target=${target}, consumed=${consumed}, pai='${pai}'`,
      );
    }

    this.updateHandOpenMeld(actor, consumed);

    const opType = data.type;
    switch (opType) {
      case OperationChiPengGang.Chi:
        if (consumed.length !== MahjongConstants.CHI_CONSUMED)
          throw new Error('Invalid consumed count');
        return [this.makeChi(actor, target, pai, consumed)];
      case OperationChiPengGang.Peng:
        if (consumed.length !== MahjongConstants.PON_CONSUMED)
          throw new Error('Invalid consumed count');
        return [this.makePon(actor, target, pai, consumed)];
      case OperationChiPengGang.Gang:
        if (consumed.length !== MahjongConstants.DAIMINKAN_CONSUMED)
          throw new Error('Invalid consumed count');
        return [this.makeDaiminkan(actor, target, pai, consumed)];
      default:
        logger.error(`Unknown ActionChiPengGang type: ${opType}`);
        return [];
    }
  }

  private handleActionAnGangAddGang(actionData: Record<string, unknown>): AkagiEvent[] {
    const data = actionData.data as Record<string, unknown>;
    const actor = data.seat as number;
    const pai = MS_TILE_2_MJAI_TILE[data.tiles as string];
    let consumed: string[];

    switch (data.type) {
      case OperationAnGangAddGang.AnGang:
        consumed = Array(MahjongConstants.ANKAN_TILES).fill(pai.replace('r', ''));
        if (pai[0] === '5' && pai[1] !== 'z') {
          consumed[0] += 'r';
        }
        this.updateHandKan(actor, consumed, false);
        return [this.makeAnkan(actor, consumed)];

      case OperationAnGangAddGang.AddGang:
        consumed = Array(MahjongConstants.KAKAN_CONSUMED).fill(pai.replace('r', ''));
        if (pai[0] === '5' && !pai.endsWith('r')) {
          consumed[0] += 'r';
        }
        this.updateHandKan(actor, consumed, true, pai);
        return [this.makeKakan(actor, pai, consumed)];
    }
    return [];
  }

  private handleDoraUpdate(actionData: Record<string, unknown>): AkagiEvent[] {
    const data = actionData.data as Record<string, unknown> | undefined;
    if (data?.doras) {
      const doras = data.doras as string[];
      if (doras.length > this.doras.length) {
        this.doras = doras;
        return [this.makeDora(MS_TILE_2_MJAI_TILE[doras[doras.length - 1]])];
      }
    }
    return [];
  }

  private handleActionDealTile(actionData: Record<string, unknown>): AkagiEvent[] {
    const data = actionData.data as Record<string, unknown>;
    const actor = data.seat as number;
    let pai = '?';
    if (data.tile) {
      pai = MS_TILE_2_MJAI_TILE[data.tile as string];
      if (actor === this.seat) {
        this.myTsumohai = pai;
      }
    }
    return [this.makeTsumo(actor, pai)];
  }

  private handleActionDiscardTile(actionData: Record<string, unknown>): AkagiEvent[] {
    const ret: AkagiEvent[] = [];
    const data = actionData.data as Record<string, unknown>;
    const actor = data.seat as number;
    this.lastDiscard = actor;
    const pai = MS_TILE_2_MJAI_TILE[data.tile as string];
    const tsumogiri = data.moqie as boolean;

    if (data.isLiqi) {
      ret.push(this.makeReach(actor));
    }
    ret.push(this.makeDahai(actor, pai, tsumogiri));

    this.updateHandDiscard(actor, pai, tsumogiri);

    if (data.isLiqi) {
      this.acceptReach = this.makeReachAccepted(actor);
    }
    return ret;
  }

  private handleActionBaBei(actionData: Record<string, unknown>): AkagiEvent[] {
    const data = actionData.data as Record<string, unknown>;
    const actor = data.seat as number;
    if (actor === this.seat) {
      const idx = this.myTehais.indexOf('N');
      if (idx !== -1) {
        this.myTehais.splice(idx, 1);
      } else if (this.myTsumohai === 'N') {
        this.myTsumohai = null;
      } else {
        logger.warn(`Nukidora 'N' not found in hand ${this.myTehais}`);
      }
      this.saveTsumohaiToHand();
    }
    return [this.makeNukidora(actor)];
  }

  private handleActionPrototype(liqiMessage: LiqiMessage): AkagiEvent[] {
    const ret: AkagiEvent[] = [];
    const actionData = liqiMessage.data as Record<string, unknown>;
    const actionName = actionData.name as string;

    switch (actionName) {
      case 'ActionNewRound':
        ret.push(...this.handleActionNewRound(actionData));
        break;
      case 'ActionDealTile':
        ret.push(...this.handleActionDealTile(actionData));
        break;
      case 'ActionDiscardTile':
        ret.push(...this.handleActionDiscardTile(actionData));
        break;
      case 'ActionChiPengGang':
        ret.push(...this.handleActionChiPengGang(actionData));
        break;
      case 'ActionAnGangAddGang':
        ret.push(...this.handleActionAnGangAddGang(actionData));
        break;
      case 'ActionBaBei':
        ret.push(...this.handleActionBaBei(actionData));
        break;
      case 'ActionHule':
      case 'ActionNoTile':
      case 'ActionLiuJu':
        return [this.makeEndKyoku()];
    }

    if (this.acceptReach) {
      ret.push(this.acceptReach);
      this.acceptReach = null;
    }

    ret.push(...this.handleDoraUpdate(actionData));
    return ret;
  }

  private handleGameEnd(data: Record<string, unknown> | undefined): AkagiEvent[] {
    const result = data?.result as Record<string, unknown> | undefined;
    const players = result?.players as Record<string, unknown>[] | undefined;
    if (players) {
      for (let idx = 0; idx < players.length; idx++) {
        const player = players[idx];
        if (player.seat === this.seat) {
          this.rank = idx + 1;
          this.score = player.partPoint1 as number;
        }
      }
    }
    this.gameEnded = true;
    return [this.makeEndGame()];
  }

  private handleAuthGame(liqiMessage: LiqiMessage, msgType: MsgType): AkagiEvent[] {
    if (msgType === MsgType.Req) return this.parseAuthGameReq(liqiMessage);
    if (msgType === MsgType.Res) return this.parseAuthGameRes(liqiMessage);
    return [];
  }

  private parseLiqi(liqiMessage: LiqiMessage): AkagiEvent[] {
    if (!liqiMessage || !liqiMessage.method) return [];

    const { method, type, data } = liqiMessage;
    let result: AkagiEvent[] = [];

    switch (method) {
      case '.lq.FastTest.syncGame':
        if (type === MsgType.Res) {
          result = this.parseSyncGame(liqiMessage);
        }
        break;
      case '.lq.FastTest.enterGame':
        if (type === MsgType.Res) {
          result = this.parseEnterGame(liqiMessage);
        }
        break;
      case '.lq.FastTest.authGame':
        result = this.handleAuthGame(liqiMessage, type);
        break;
      case '.lq.ActionPrototype':
        result = this.handleActionPrototype(liqiMessage);
        break;
      case '.lq.NotifyGameEndResult':
      case '.lq.NotifyGameTerminate':
        result = this.handleGameEnd(data as Record<string, unknown>);
        break;
    }

    return result;
  }
}
