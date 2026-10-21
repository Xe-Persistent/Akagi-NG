import { HandLedger } from '../../shared/hand-ledger.js';
import { MAHJONG, MELD_TILE_COUNTS } from '../../shared/schema/mahjong.js';
import type { MJAIEvent } from '../../shared/schema/mjai.js';
import type { EngineAction } from './recommendation-mapper.js';

/** One call we made; only a pon can still become an added kan. */
interface OurMeld {
  type: 'chi' | 'pon' | 'daiminkan';
  pai: string;
  consumed: string[];
}

/**
 * The round as the HUD needs it, rebuilt from the mjai events the engine
 * already sees: our hand and melds, the discard a call could claim, the last
 * drawn and claimed tiles, and whether the round is already won.
 *
 * Two of its jobs are reconstruction the online service needs — the tiles
 * behind a coarse call label, and the seat a bare `hora` wins from; the rest is
 * context the recommendation mapper reads.
 */
export class RoundState {
  private readonly hand = new HandLedger();
  private seat = -1;
  private melds: OurMeld[] = [];
  /** The discard still claimable by a call; any other event closes the window. */
  private claimable: string | null = null;
  private lastDrawnTile: string | null = null;
  private lastDiscardTile: string | null = null;
  private wonThisRound = false;
  /** The event that opened the decision being answered, if any. */
  private lastEvent: MJAIEvent | null = null;

  /** True once our own win has closed the round for us. */
  public get won(): boolean {
    return this.wonThisRound;
  }

  /** The tile we last drew, shown next to a tsumo recommendation. */
  public get lastDrawn(): string | null {
    return this.lastDrawnTile;
  }

  /** The last tile we could ron: a discard, or the tile added to a kan. */
  public get lastDiscard(): string | null {
    return this.lastDiscardTile;
  }

  public reset(): void {
    this.hand.reset();
    this.seat = -1;
    this.melds = [];
    this.claimable = null;
    this.lastDrawnTile = null;
    this.lastDiscardTile = null;
    this.wonThisRound = false;
    this.lastEvent = null;
  }

  /**
   * @param seat - our seat, when the caller knows it better than the stream
   *   does; the engine passes the seat it was started with.
   */
  public update(event: MJAIEvent, seat?: number): void {
    if (event.type === 'start_game') {
      this.reset();
      this.seat = seat ?? event.id;
      this.lastEvent = event;
      return;
    }

    if (seat !== undefined) this.seat = seat;
    this.lastEvent = event;
    // Only a discard opens a call window; the next event of any kind ends it.
    this.claimable = null;
    if (this.seat < 0) return;

    this.trackTiles(event);
    this.trackRound(event);

    switch (event.type) {
      case 'start_kyoku':
        this.hand.reset(
          (event.tehais[this.seat] ?? []).filter((tile) => tile !== MAHJONG.UNKNOWN_TILE),
        );
        this.melds = [];
        this.lastDrawnTile = null;
        this.lastDiscardTile = null;
        return;
      case 'tsumo':
        if (event.actor === this.seat) this.hand.draw(event.pai);
        return;
      case 'dahai':
        if (event.actor !== this.seat) {
          this.claimable = event.pai;
          return;
        }
        this.hand.discard(event.pai, event.tsumogiri);
        return;
      case 'chi':
      case 'pon':
      case 'daiminkan':
        if (event.actor !== this.seat) return;
        this.hand.consume(event.consumed);
        this.melds.push({ type: event.type, pai: event.pai, consumed: [...event.consumed] });
        return;
      case 'ankan':
        if (event.actor !== this.seat) return;
        this.hand.consume(event.consumed);
        return;
      case 'kakan':
        if (event.actor !== this.seat) return;
        this.hand.removeHeld(event.pai);
        this.upgradePon(event.pai);
        return;
      case 'kita':
        if (event.actor !== this.seat) return;
        this.hand.removeHeld(MAHJONG.NORTH_TILE);
        this.hand.foldDraw();
        return;
      default:
        return;
    }
  }

  /**
   * The losing seat a win would pay, when the event that opened this decision
   * allows one: our own seat on a self-draw, the discarder (or kan robber)
   * otherwise. `null` when no win is possible, which stops a bare `hora` label
   * from being guessed into the wrong row.
   */
  public winTarget(): number | null {
    const event = this.lastEvent;
    if (!event || this.seat < 0) return null;
    if (event.type === 'tsumo' && event.actor === this.seat) return this.seat;
    if ((event.type === 'dahai' || event.type === 'kakan') && event.actor !== this.seat) {
      return event.actor;
    }
    return null;
  }

  /**
   * The concrete actions behind one coarse top-k call label, or an empty list
   * when the label names no call or the hand cannot support it. A `kan` label
   * covers every kan, so it can resolve to more than one row.
   */
  public resolveCall(label: string): EngineAction[] {
    switch (label) {
      case 'pon': {
        const target = this.claimable;
        if (!target) return [];
        const consumed = this.hand.take(target, MELD_TILE_COUNTS.pon);
        return consumed ? [{ type: 'pon', pai: target, consumed }] : [];
      }
      case 'chi_low':
      case 'chi_mid':
      case 'chi_high': {
        const target = this.claimable;
        if (!target) return [];
        const consumed = this.chiConsumed(target, label);
        return consumed ? [{ type: 'chi', pai: target, consumed }] : [];
      }
      case 'kan':
        return this.kanActions();
      default:
        return [];
    }
  }

  private trackTiles(event: MJAIEvent): void {
    if (event.type === 'tsumo' && event.actor === this.seat) {
      this.lastDrawnTile = event.pai;
    } else if (event.type === 'dahai' && event.actor !== this.seat) {
      this.lastDiscardTile = event.pai;
    } else if (event.type === 'kakan' && event.actor !== this.seat) {
      // A robbed kan is a ron on the tile that was added to the meld.
      this.lastDiscardTile = event.pai;
    }
  }

  private trackRound(event: MJAIEvent): void {
    if (event.type === 'start_kyoku') {
      this.wonThisRound = false;
    } else if (event.type === 'hora' && event.actor === this.seat) {
      this.wonThisRound = true;
    }
  }

  /** The two tiles a `chi_low` / `chi_mid` / `chi_high` claims next to `target`. */
  private chiConsumed(target: string, label: string): string[] | null {
    const base = target.replace(MAHJONG.RED_FIVE_SUFFIX, '');
    const number = Number(base[0]);
    const suit = base[1];
    if (suit === undefined) return null;
    if (!Number.isInteger(number) || number < 1 || number > 9) return null;
    if (!MAHJONG.SUITS.includes(suit)) return null;

    const offsets = label === 'chi_low' ? [1, 2] : label === 'chi_mid' ? [-1, 1] : [-2, -1];
    const wanted = offsets.map((offset) => number + offset);
    if (wanted.some((value) => value < 1 || value > 9)) return null;

    const consumed: string[] = [];
    for (const value of wanted) {
      const one = this.hand.take(`${value}${suit}`, 1);
      const tile = one?.[0];
      if (tile === undefined) return null;
      consumed.push(tile);
    }
    return consumed;
  }

  private kanActions(): EngineAction[] {
    const actions: EngineAction[] = [];

    // An open kan claims the discard still on the table.
    if (this.claimable) {
      const open = this.hand.take(this.claimable, MELD_TILE_COUNTS.daiminkan);
      if (open) actions.push({ type: 'daiminkan', pai: this.claimable, consumed: open });
    }

    // A closed kan needs all four copies in hand, red five included.
    const seen = new Set<string>();
    for (const tile of this.hand.tiles) {
      const base = tile.replace(MAHJONG.RED_FIVE_SUFFIX, '');
      if (seen.has(base)) continue;
      seen.add(base);
      const four = this.hand.take(base, MELD_TILE_COUNTS.ankan);
      if (four) actions.push({ type: 'ankan', consumed: four });
    }

    // An added kan is a pon already on the table plus the tile just drawn.
    for (const meld of this.melds) {
      if (meld.type !== 'pon') continue;
      const added = this.hand.take(meld.pai, 1)?.[0];
      if (added !== undefined) actions.push({ type: 'kakan', pai: added, consumed: [added] });
    }

    return actions;
  }

  private upgradePon(pai: string): void {
    const base = pai.replace(MAHJONG.RED_FIVE_SUFFIX, '');
    const meld = this.melds.find(
      (each) => each.type === 'pon' && each.pai.replace(MAHJONG.RED_FIVE_SUFFIX, '') === base,
    );
    if (meld) meld.type = 'daiminkan';
  }
}
