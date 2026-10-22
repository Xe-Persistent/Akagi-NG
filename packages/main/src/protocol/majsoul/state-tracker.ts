import { createLogger } from '../../logging/index.js';
import { HandLedger } from '../../shared/hand-ledger.js';
import { MAHJONG } from '../../shared/schema/mahjong.js';
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

  /** The seat that discarded last: a ron pays from this seat. */
  public lastDiscarder: number | null = null;
  public doras: string[] = [];
  /** The game reports `xuezhandaodi`: rounds swap three tiles and do not stop at the first win. */
  public isXuezhan = false;
  /** `reach_accepted` event waiting to be appended after the current action. */
  public pendingReachAccepted: ReachAcceptedEvent | null = null;

  /** Our own hand and draw, shared with the HUD's round state. */
  private readonly hand = new HandLedger();

  public get myTehais(): string[] {
    return this.hand.tiles;
  }

  public set myTehais(tiles: string[]) {
    this.hand.setTiles(tiles);
  }

  public get myTsumohai(): string | null {
    return this.hand.pending;
  }

  constructor() {
    this.reset();
  }

  public reset() {
    this.accountId = 0;
    this.seat = 0;
    this.is3p = false;
    this.isXuezhan = false;
    this.gameEnded = false;
    this.lastDiscarder = null;
    this.doras = [];
    this.hand.reset(Array<string>(MAHJONG.TEHAI_SIZE).fill(MAHJONG.UNKNOWN_TILE));
    this.hand.setPending(null);
    this.pendingReachAccepted = null;
  }

  /** A tile was dealt to us; it stays out of the hand until it is played. */
  public onDraw(pai: string) {
    this.hand.draw(pai);
  }

  /**
   * Builds the four-seat `tehais` matrix used by `start_kyoku` and stores our
   * own hand. A dealer's deal carries fourteen tiles -- the hand plus the tile
   * already drawn -- while every other deal carries thirteen. Returns null when
   * the tile list has an unexpected length.
   */
  public setupNewRound(tiles: string[]): { tehais: string[][]; myTsumohai: string | null } | null {
    const tehais = Array.from({ length: MAHJONG.SEATS_4P }, () =>
      Array<string>(MAHJONG.TEHAI_SIZE).fill(MAHJONG.UNKNOWN_TILE),
    );

    const hand = tiles.slice(0, MAHJONG.TEHAI_SIZE).map((tile) => toMjaiTile(tile));

    if (tiles.length === MAHJONG.TEHAI_SIZE) {
      const sortedHand = hand.sort(comparePai);
      this.hand.reset(sortedHand);
      tehais[this.seat] = [...sortedHand];
      return { tehais, myTsumohai: null };
    }

    if (tiles.length === MAHJONG.TEHAI_SIZE_WITH_DRAW) {
      // The last tile of the payload is the one that was drawn -- not whichever
      // tile happens to sort highest -- so the hand is the other thirteen.
      const tsumohai = tiles.at(MAHJONG.TEHAI_SIZE);
      if (tsumohai === undefined) return null;
      const sortedHand = hand.sort(comparePai);

      this.hand.reset(sortedHand);
      this.hand.draw(toMjaiTile(tsumohai));
      tehais[this.seat] = [...sortedHand];
      return { tehais, myTsumohai: toMjaiTile(tsumohai) };
    }

    logger.error(`Unexpected tile count in ActionNewRound: ${tiles.length}`);
    return null;
  }

  /**
   * Moves the drawn tile into the hand before a meld/discard is applied, so a
   * following draw event cannot overwrite it.
   */
  public saveTsumohaiToHand() {
    this.hand.foldDraw();
    this.hand.tiles.sort(comparePai);
  }

  public onDiscard(actor: number, pai: string, tsumogiri: boolean) {
    if (actor !== this.seat) return;

    if (!this.hand.discard(pai, tsumogiri)) {
      logger.warn(`Discarded tile ${pai} not found in hand ${this.hand.tiles.join(' ')}`);
    }

    this.hand.tiles.sort(comparePai);
  }

  public onOpenMeld(actor: number, consumed: string[]) {
    if (actor !== this.seat) return;

    this.hand.consume(consumed);
  }

  public onKan(actor: number, consumed: string[], isKakan: boolean, pai?: string) {
    if (actor !== this.seat) return;

    this.saveTsumohaiToHand();

    if (isKakan && pai) {
      this.hand.consume([pai]);
    } else if (!isKakan) {
      this.hand.consume(consumed);
    }
  }

  public onNukidora(actor: number) {
    if (actor !== this.seat) return;

    if (!this.hand.removeHeld(MAHJONG.NORTH_TILE)) {
      logger.warn(`Nukidora 'N' not found in hand ${this.hand.tiles.join(' ')}`);
    }

    this.hand.foldDraw();
    this.hand.tiles.sort(comparePai);
  }
}
