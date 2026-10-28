/**
 * A recorded kyoku in which another seat adds to its pon -- the one window where
 * a tile can be robbed off the table. The stream comes from a v1.0.x sanma game
 * (`akagi_20260316_162109.log`, kyoku 8); the mjai vocabulary has not changed,
 * so it drives the current engine unchanged.
 *
 * The hand cannot rob the E, so the only legal answer is to pass: a single legal
 * action is not a choice, and the HUD must keep what it showed rather than a row
 * nobody can act on. What the kakan does have to prove is that it does not
 * disturb the rest of the round.
 */
import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';
import { hasEngineFor } from '../engine-availability.js';

interface Published {
  action: string;
  confidence: number;
}

const events: MJAIEvent[] = readFileSync(
  new URL('../fixtures/kakan.jsonl', import.meta.url),
  'utf8',
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as MJAIEvent);

const is3p =
  (events.find((event) => event.type === 'start_game') as { num_players: number }).num_players ===
  3;
/** The seat the fixture was recorded from; mjai carries it beside the stream. */
const SEAT = 1;

const indexOf = (type: string) => events.findIndex((event) => event.type === type);

describe.skipIf(!hasEngineFor(is3p))('a kakan nobody robs', () => {
  /** Cumulative recommendation count after each event, indexed by event. */
  const publishedAt: number[] = [];

  beforeAll(async () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      for (const [index, event] of events.entries()) {
        const seat = event.type === 'start_game' ? SEAT : undefined;
        await engine.ingest([event], false, seat);
        publishedAt[index] = messagesOn('engine:recommendations').length;
      }
    } finally {
      engine.stop();
    }
  }, 120_000);

  it('loads the model, otherwise the rest would be vacuous', () => {
    const models = messagesOn<{ model: string }>('engine:status').map((status) => status.model);

    expect(models).toContain('ready');
    expect(models).not.toContain('failed');
  });

  it('never lets the engine reject an event', () => {
    const notices = messagesOn<{ notice: { kind: string } | null }>('engine:status')
      .map((status) => status.notice?.kind)
      .filter(Boolean);

    expect(notices).not.toContain('runtime_error');
  });

  it('holds a kakan by another seat, with the dora it reveals', () => {
    const kakan = events[indexOf('kakan')] as { actor: number; consumed: string[] };

    // Someone else's kakan is the window we could rob; our own would only hand
    // the turn back to us.
    expect(kakan.actor).not.toBe(SEAT);
    expect(kakan.consumed).toHaveLength(3);
    // The replacement tile turns a new dora indicator, which the stream carries.
    expect(events.slice(indexOf('kakan')).some((event) => event.type === 'dora')).toBe(true);
  });

  it('says nothing when passing is the only legal answer', () => {
    const kakan = indexOf('kakan');

    expect(publishedAt[kakan - 1]).toBeGreaterThan(0);
    expect(publishedAt[kakan]).toBe(publishedAt[kakan - 1]);
  });

  it('keeps answering for the rest of the round', () => {
    const kakan = indexOf('kakan');
    const after = events.slice(kakan + 1);

    expect(after.length).toBeGreaterThan(0);
    expect(publishedAt.at(-1)).toBeGreaterThan(publishedAt[kakan]!);
  });

  it('only publishes on our own turn', () => {
    const published = events.filter((_event, index) => {
      const before = publishedAt[index - 1] ?? 0;

      return publishedAt[index]! > before;
    });

    expect(published.length).toBeGreaterThan(0);
    for (const event of published) {
      expect(event).toMatchObject({ type: 'tsumo', actor: SEAT });
    }
  });

  it('publishes the HUD contract, sorted by confidence', () => {
    const payloads = messagesOn<{ recommendations: Published[] }>('engine:recommendations');

    for (const { recommendations } of payloads) {
      expect(recommendations.length).toBeGreaterThan(0);

      const confidences = recommendations.map((row) => row.confidence);
      expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    }
  });
});

/**
 * The same recording read from the kan declarer's seat.
 *
 * `apply_mjai_event` leaves the declarer in `WaitAct` after applying a kakan, so
 * the engine still reports a non-forced decision when the kan lands. Asking there
 * published a row for a hand that had already given up its turn, and the
 * replacement draw published again a moment later -- the pair the HUD showed as
 * "a recommendation at the kan, then the real one".
 */
describe.skipIf(!hasEngineFor(is3p))('a kakan of our own', () => {
  const publishedAt: number[] = [];

  beforeAll(async () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      for (const [index, event] of events.entries()) {
        // The fixture only reveals seat 1's hand, so reading it from seat 2
        // leaves every tile masked: enough to prove when the service asks, and
        // deliberately not enough to say anything about the answer.
        const seat = event.type === 'start_game' ? 2 : undefined;
        await engine.ingest([event], false, seat);
        publishedAt[index] = messagesOn('engine:recommendations').length;
      }
    } finally {
      engine.stop();
    }
  }, 120_000);

  it('says nothing at the kan itself', () => {
    const kakan = indexOf('kakan');

    expect(publishedAt[kakan - 1]).toBeGreaterThan(0);
    expect(publishedAt[kakan]).toBe(publishedAt[kakan - 1]);
  });

  it('answers again for the replacement draw', () => {
    const kakan = indexOf('kakan');

    expect(publishedAt[kakan + 1]).toBeGreaterThan(publishedAt[kakan]!);
  });
});
