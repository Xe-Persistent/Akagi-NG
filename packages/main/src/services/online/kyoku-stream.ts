import { MAHJONG } from '../../shared/schema/mahjong.js';
import type { MJAIEvent, StartKyokuEvent, TsumoEvent } from '../../shared/schema/mjai.js';

/** Seats every online request is shaped to, including a phantom fourth in sanma. */
const SEATS = MAHJONG.SEATS_4P;
/** The mjai spelling of a tile the client is not allowed to see. */
const HIDDEN_PAI = MAHJONG.UNKNOWN_TILE;
const HIDDEN_HAND: readonly string[] = Array.from({ length: MAHJONG.TEHAI_SIZE }, () => HIDDEN_PAI);
/** The service rejects a request longer than this; a kyoku is nowhere near it. */
export const MAX_API_EVENTS = 512;

/** One mjai event as it goes on the wire. */
export type ApiEvent = Record<string, unknown>;

/**
 * The per-kyoku window uploaded to `/v3/react`.
 *
 * The service is stateless: every decision re-uploads the events of the current
 * kyoku from our seat's censored perspective. `start_kyoku` drops the previous
 * round's tail but keeps the leading `start_game`, because the service requires
 * `events[0]` to be one. Events accumulate even while online inference is off, so
 * enabling it mid-kyoku can upload the round so far.
 */
export class KyokuStream {
  private events: MJAIEvent[] = [];

  public get empty(): boolean {
    return this.events.length === 0;
  }

  public accumulate(event: MJAIEvent): void {
    if (event.type === 'start_game') {
      this.events = [event];
      return;
    }
    if (event.type === 'start_kyoku') {
      const startGame = this.events[0]?.type === 'start_game' ? [this.events[0]] : [];
      this.events = [...startGame, event];
      return;
    }
    this.events.push(event);
  }

  public reset(): void {
    this.events = [];
  }

  /** The shaped body for this window; `buildApiEvents` below holds the rules. */
  public buildApiEvents(seat: number, is3p: boolean): ApiEvent[] | null {
    return buildApiEvents(this.events, seat, is3p);
  }
}

/**
 * The shaped request body for a window, or `null` when it cannot be uploaded: a
 * game observed from mid-round has no `start_game`, and an over-long window
 * means the stream was never reset. Uploading either would produce a stream the
 * service cannot replay, which reads as a desync (null reaction).
 */
export function buildApiEvents(
  events: readonly MJAIEvent[],
  seat: number,
  is3p: boolean,
): ApiEvent[] | null {
  if (events.length > MAX_API_EVENTS) return null;
  const [first] = events;
  if (first?.type !== 'start_game') return null;
  if (!events.some((event) => event.type === 'start_kyoku')) return null;

  return events.map((event) => shapeEvent(event, seat, is3p));
}

function shapeEvent(event: MJAIEvent, seat: number, is3p: boolean): ApiEvent {
  switch (event.type) {
    case 'start_game':
      return shapeStartGame(is3p);
    case 'start_kyoku':
      return shapeStartKyoku(event, seat, is3p);
    case 'tsumo':
      return shapeTsumo(event, seat);
    case 'reach':
      // The service wants a bare reach; a predicted discard is not part of the
      // observed stream and would desync the replay.
      return { type: 'reach', actor: event.actor };
    case 'kita':
      // Canonical mjai carries the actor only: the tile is always the north, and
      // the service's own event has no `pai` on it.
      return { type: 'kita', actor: event.actor };
    default:
      return { ...event };
  }
}

/**
 * Nicknames never leave the machine, and the service only uses seats. `PlayerN`
 * keeps the array shape without leaking who was at the table.
 */
function shapeStartGame(is3p: boolean): ApiEvent {
  const names = Array.from({ length: is3p ? SEATS - 1 : SEATS }, (_, index) => `Player${index}`);
  if (is3p) names.push('');
  return { type: 'start_game', names };
}

function shapeStartKyoku(event: StartKyokuEvent, seat: number, is3p: boolean): ApiEvent {
  const tehais = event.tehais.map((hand, index) => (index === seat ? [...hand] : [...HIDDEN_HAND]));
  const scores = [...event.scores];

  if (is3p) {
    // A phantom fourth seat: empty name, zero score, thirteen hidden tiles.
    while (scores.length < SEATS) scores.push(0);
    while (tehais.length < SEATS) tehais.push([...HIDDEN_HAND]);
  }

  return {
    type: 'start_kyoku',
    bakaze: event.bakaze,
    dora_marker: event.dora_marker,
    kyoku: event.kyoku,
    honba: event.honba,
    kyotaku: event.kyotaku,
    oya: event.oya,
    scores,
    tehais,
  };
}

function shapeTsumo(event: TsumoEvent, seat: number): ApiEvent {
  // Nobody sees another seat's draw.
  return { type: 'tsumo', actor: event.actor, pai: event.actor === seat ? event.pai : HIDDEN_PAI };
}
