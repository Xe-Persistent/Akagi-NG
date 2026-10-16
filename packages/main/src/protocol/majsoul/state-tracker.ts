import { createLogger } from '../../logging/index.js';
import { MahjongConstants } from '../../shared/schema/mahjong.js';
import type { ReachAcceptedEvent } from '../../shared/schema/mjai.js';
import { comparePai, toMjaiTile } from './tile-mapping.js';

const logger = createLogger('MajsoulState');

/**
 * Tracks the local player's view of a Majsoul game (seat, hand, draws, dora)
 * while Majsoul actions are being converted into mjai events.
 */
export class MajsoulStateTracker {
  public accountId = 0;
  public seat = 0;
  public is3p = false;
  public gameEnded = false;

  public lastDiscard: number | null = null;
  public doras: string[] = [];
  /** The game reports `xuezhandaodi`: rounds swap three tiles and do not stop at the first win. */
  public isXuezhan = false;
  public myTehais: string[] = [];
  public myTsumohai: string | null = null;
  /** `reach_accepted` event waiting to be appended after the current action. */
  public pendingReachAccepted: ReachAcceptedEvent | null = null;

  constructor() {
    this.reset();
  }

  public reset() {
    this.accountId = 0;
    this.seat = 0;
    this.is3p = false;
    this.isXuezhan = false;
    this.gameEnded = false;
    this.lastDiscard = null;
    this.doras = [];
    this.myTehais = Array<string>(MahjongConstants.TEHAI_SIZE).fill('?');
    this.myTsumohai = '?';
    this.pendingReachAccepted = null;
  }

  /**
   * Builds the four-seat `tehais` matrix used by `start_kyoku` and stores our
   * own hand. Returns null when the tile list has an unexpected length.
   */
  public setupNewRound(tiles: string[]): { tehais: string[][]; myTsumohai: string | null } | null {
    const tehais = Array.from({ length: MahjongConstants.SEATS_4P }, () =>
      Array<string>(MahjongConstants.TEHAI_SIZE).fill('?'),
    );

    const hand = tiles.slice(0, MahjongConstants.TEHAI_SIZE).map((tile) => toMjaiTile(tile));

    if (tiles.length === MahjongConstants.TEHAI_SIZE) {
      const sortedHand = hand.sort(comparePai);
      this.myTehais = sortedHand;
      this.myTsumohai = null;
      tehais[this.seat] = [...sortedHand];
      return { tehais, myTsumohai: null };
    }

    if (tiles.length === MahjongConstants.TSUMO_TEHAI_SIZE) {
      const withDraw = [...hand, toMjaiTile(tiles[MahjongConstants.TEHAI_SIZE])].sort(comparePai);
      const sortedHand = withDraw.slice(0, MahjongConstants.TEHAI_SIZE);
      const tsumohai = withDraw[MahjongConstants.TEHAI_SIZE];

      this.myTehais = sortedHand;
      this.myTsumohai = tsumohai;
      tehais[this.seat] = [...sortedHand];
      return { tehais, myTsumohai: tsumohai };
    }

    logger.error(`Unexpected tile count in ActionNewRound: ${tiles.length}`);
    return null;
  }

  /**
   * Moves the drawn tile into the hand before a meld/discard is applied, so a
   * following draw event cannot overwrite it.
   */
  public saveTsumohaiToHand() {
    if (!this.myTsumohai) return;

    this.myTehais.push(this.myTsumohai);
    this.myTehais.sort(comparePai);
    this.myTsumohai = null;
  }

  /** Removes a tile from our hand, preferring an exact (red five) match. */
  public removeTileFromHand(tile: string) {
    const exactIndex = this.myTehais.indexOf(tile);
    if (exactIndex !== -1) {
      this.myTehais.splice(exactIndex, 1);
      return;
    }

    // Fall back to the base name, covering red-five / normal-five crossovers.
    const base = tile.replace('r', '');
    const baseIndex = this.myTehais.findIndex((handTile) => handTile.replace('r', '') === base);
    if (baseIndex !== -1) {
      this.myTehais.splice(baseIndex, 1);
    }
  }

  public onDiscard(actor: number, pai: string, tsumogiri: boolean) {
    if (actor !== this.seat) return;

    if (tsumogiri) {
      this.myTsumohai = null;
    } else if (this.myTehais.includes(pai)) {
      this.myTehais.splice(this.myTehais.indexOf(pai), 1);
    } else if (this.myTsumohai === pai) {
      this.myTsumohai = null;
    } else {
      logger.warn(`Discarded tile ${pai} not found in hand ${this.myTehais}`);
    }

    this.saveTsumohaiToHand();
  }

  public onOpenMeld(actor: number, consumed: string[]) {
    if (actor !== this.seat) return;

    for (const tile of consumed) {
      this.removeTileFromHand(tile);
    }
  }

  public onKan(actor: number, consumed: string[], isKakan: boolean, pai?: string) {
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

  public onNukidora(actor: number) {
    if (actor !== this.seat) return;

    if (this.myTehais.includes('N')) {
      this.myTehais.splice(this.myTehais.indexOf('N'), 1);
    } else if (this.myTsumohai === 'N') {
      this.myTsumohai = null;
    } else {
      logger.warn(`Nukidora 'N' not found in hand ${this.myTehais}`);
    }

    this.saveTsumohaiToHand();
  }
}
