/**
 * When the HUD is asked at all. `EngineService` only talks to the engine at the
 * points where the local player could act, and that table is the difference
 * between a quiet HUD and one that offers an illegal call -- so it is pinned here
 * with a stub runner rather than through a real hand that may not exercise it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';

const SEAT = 1;

interface StubRunner {
  loaded: boolean;
  feed: () => void;
  decide: () => unknown;
  reset: () => void;
  load: () => Promise<unknown>;
}

/** A non-forced decision, so a publish happens exactly when the engine is asked. */
function stubRunner(): StubRunner {
  return {
    loaded: true,
    feed: () => {},
    decide: () => ({ forced: false, candidates: [[{ type: 'pass' }, 1]], logits: [] }),
    reset: () => {},
    load: async () => ({ status: 'loaded', modelName: 'stub' }),
  };
}

function enginePlayingAsSeat(): EngineService {
  const engine = new EngineService();
  const internal = engine as unknown as { runner: StubRunner; playerId: number };
  internal.runner = stubRunner();
  internal.playerId = SEAT;
  return engine;
}

/** Feeds one event and reports whether the HUD was updated. */
async function reactsTo(engine: EngineService, event: MJAIEvent): Promise<boolean> {
  resetSentMessages();
  await engine.ingest([event]);

  return messagesOn('engine:recommendations').length > 0;
}

const event = (value: Record<string, unknown>) => value as unknown as MJAIEvent;

/** A round opening carries the dealt hands; the tracker reads our seat's. */
function startKyoku(): MJAIEvent {
  const hand = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p'];
  return event({
    type: 'start_kyoku',
    bakaze: 'E',
    dora_marker: '5s',
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    oya: 0,
    scores: [25000, 25000, 25000, 25000],
    tehais: [hand, hand, hand, hand],
  });
}

describe('the points the engine is asked at', () => {
  let engine: EngineService;

  beforeEach(() => {
    engine = enginePlayingAsSeat();
  });

  it.each([
    ['our own draw', { type: 'tsumo', actor: SEAT, pai: '4p' }],
    ["another seat's discard", { type: 'dahai', actor: 2, pai: '3p', tsumogiri: false }],
    ['a chi', { type: 'chi', actor: SEAT, target: 2, pai: '3p', consumed: ['4p', '5p'] }],
    ['a pon', { type: 'pon', actor: SEAT, target: 2, pai: '3p', consumed: ['3p', '3p'] }],
    [
      "another seat's kakan, which can be robbed",
      { type: 'kakan', actor: 2, pai: 'E', consumed: ['E', 'E', 'E'] },
    ],
    ["another seat's kita, which can be robbed", { type: 'kita', actor: 2, pai: 'N' }],
  ])('asks at %s', async (_label, payload) => {
    expect(await reactsTo(engine, event(payload))).toBe(true);
  });

  it.each([
    ['our own discard', { type: 'dahai', actor: SEAT, pai: '3p', tsumogiri: false }],
    ['another draw', { type: 'tsumo', actor: 2, pai: '?' }],
    [
      "another seat's chi, which leaves us with nothing to act on",
      { type: 'chi', actor: 2, target: 3, pai: '3p', consumed: ['4p', '5p'] },
    ],
    [
      "another seat's pon, which leaves us with nothing to act on",
      { type: 'pon', actor: 2, target: 3, pai: '3p', consumed: ['3p', '3p'] },
    ],
    ['our own kakan, after which we draw again', { type: 'kakan', actor: SEAT, pai: 'E' }],
    ['our own kita, after which we draw again', { type: 'kita', actor: SEAT, pai: 'N' }],
    ['a riichi declaration', { type: 'reach', actor: 2 }],
    ['an accepted riichi', { type: 'reach_accepted', actor: 2 }],
    ['a new dora', { type: 'dora', dora_marker: '5s' }],
    ['a round closing', { type: 'end_kyoku' }],
  ])('stays quiet at %s', async (_label, payload) => {
    expect(await reactsTo(engine, event(payload))).toBe(false);
  });

  it('waits for the replacement draw after our own kan', async () => {
    // The engine leaves the declarer in `WaitAct`, so a legal set is still there
    // when the kakan lands: asking at that instant published a row for a hand
    // that was about to draw again, a moment before the real decision.
    expect(await reactsTo(engine, event({ type: 'kakan', actor: SEAT, pai: 'E' }))).toBe(false);

    expect(await reactsTo(engine, event({ type: 'tsumo', actor: SEAT, pai: '9p' }))).toBe(true);
  });

  it('stays quiet at a round opening', async () => {
    expect(await reactsTo(engine, startKyoku())).toBe(false);
  });

  it('stays quiet for the rest of a round we have already won', async () => {
    // A blood battle carries on without us, and a hand that no longer draws has
    // nothing left to recommend.
    await engine.ingest([event({ type: 'hora', actor: SEAT, target: 2, pai: '3p' })]);

    expect(await reactsTo(engine, event({ type: 'tsumo', actor: SEAT, pai: '4p' }))).toBe(false);
    expect(await reactsTo(engine, event({ type: 'dahai', actor: 2, pai: '9m' }))).toBe(false);
  });

  it('answers again once the next round opens', async () => {
    await engine.ingest([event({ type: 'hora', actor: SEAT, target: 2, pai: '3p' })]);

    expect(await reactsTo(engine, startKyoku())).toBe(false);
    expect(await reactsTo(engine, event({ type: 'tsumo', actor: SEAT, pai: '4p' }))).toBe(true);
  });

  it('says nothing while the engine has no model', async () => {
    const internal = engine as unknown as { runner: StubRunner };
    internal.runner.loaded = false;

    expect(await reactsTo(engine, event({ type: 'tsumo', actor: SEAT, pai: '4p' }))).toBe(false);
  });

  it('stays quiet when a single legal action leaves no choice', async () => {
    const internal = engine as unknown as { runner: StubRunner };
    internal.runner.decide = () => ({
      forced: true,
      candidates: [[{ type: 'pass' }, 1]],
      logits: [],
    });

    expect(await reactsTo(engine, event({ type: 'tsumo', actor: SEAT, pai: '4p' }))).toBe(false);
  });
});

describe('a batch replayed from a restore', () => {
  /** Three decision points, of which only the last is where the table stands now. */
  const history = [
    event({ type: 'tsumo', actor: SEAT, pai: '4p' }),
    event({ type: 'dahai', actor: 2, pai: '9s', tsumogiri: true }),
    event({ type: 'tsumo', actor: SEAT, pai: '6p' }),
  ];

  it('answers once, for the state the history ends in', async () => {
    resetSentMessages();

    await enginePlayingAsSeat().ingest(history, true);

    expect(messagesOn('engine:recommendations')).toHaveLength(1);
  });

  it('answers at every decision point of a live batch', async () => {
    resetSentMessages();

    await enginePlayingAsSeat().ingest(history);

    expect(messagesOn('engine:recommendations')).toHaveLength(3);
  });
});
