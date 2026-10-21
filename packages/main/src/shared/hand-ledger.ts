import { MAHJONG } from './schema/mahjong.js';

/**
 * The tiles one seat holds, as both the wire tracker and the HUD state need
 * them: the concealed hand, the tile just drawn, and the red-five-aware rules
 * for taking a tile back out. Keeping this in one place means a call spends the
 * same copies whichever layer asked.
 */
export class HandLedger {
  private concealed: string[] = [];
  private drawn: string | null = null;

  /** The concealed hand. Live: callers that sort it in place are expected. */
  public get tiles(): string[] {
    return this.concealed;
  }

  public get pending(): string | null {
    return this.drawn;
  }

  public reset(tiles: readonly string[] = []): void {
    this.concealed = [...tiles];
    this.drawn = null;
  }

  /** Replaces the concealed hand, leaving a pending draw alone. */
  public setTiles(tiles: readonly string[]): void {
    this.concealed = [...tiles];
  }

  public setPending(tile: string | null): void {
    this.drawn = tile;
  }

  public draw(tile: string): void {
    this.drawn = tile;
  }

  /** Moves the drawn tile into the hand, so the next draw cannot overwrite it. */
  public foldDraw(): void {
    if (this.drawn === null) return;
    this.concealed.push(this.drawn);
    this.drawn = null;
  }

  /**
   * Plays a tile. `true` when the tile was where the event said it was; a
   * caller that cares (the wire tracker warns) can act on that.
   */
  public discard(tile: string, tsumogiri: boolean): boolean {
    let found = true;

    if (tsumogiri) {
      this.drawn = null;
    } else if (!this.removeConcealed(tile)) {
      if (this.drawn === tile) {
        this.drawn = null;
      } else {
        found = false;
      }
    }

    this.foldDraw();
    return found;
  }

  /** Spends the tiles a call took from the concealed hand. */
  public consume(tiles: readonly string[]): void {
    for (const tile of tiles) this.removeConcealed(tile);
  }

  /** Removes a tile that may be the drawn one (an added kan, a north). */
  public removeHeld(tile: string): boolean {
    if (this.removeConcealed(tile)) return true;
    if (this.drawn !== tile) return false;
    this.drawn = null;
    return true;
  }

  /** Removes an exact tile, else the same tile without its red mark. */
  public removeConcealed(tile: string): boolean {
    const exact = this.concealed.indexOf(tile);
    if (exact >= 0) {
      this.concealed.splice(exact, 1);
      return true;
    }

    const base = tile.replace(MAHJONG.RED_FIVE_SUFFIX, '');
    const index = this.concealed.findIndex(
      (held) => held.replace(MAHJONG.RED_FIVE_SUFFIX, '') === base,
    );
    if (index < 0) return false;
    this.concealed.splice(index, 1);
    return true;
  }

  /**
   * `count` copies of `tile` from the concealed hand, red five first; `null`
   * when the hand is short. Read-only, so several candidate calls can ask about
   * the same hand before one of them is played.
   */
  public take(tile: string, count: number): string[] | null {
    const base = tile.replace(MAHJONG.RED_FIVE_SUFFIX, '');
    const pool = [...this.concealed];
    const picked: string[] = [];

    const grab = (wanted: string): boolean => {
      const index = pool.indexOf(wanted);
      if (index < 0) return false;
      pool.splice(index, 1);
      picked.push(wanted);
      return true;
    };

    // A call gives up the red five first, the same rule v1.0.8 used.
    if (base.startsWith('5')) grab(`${base}r`);
    while (picked.length < count) {
      if (!grab(base)) return null;
    }
    return picked;
  }
}
