/**
 * The riichi lookahead is the one recommendation that carries more than a single
 * action: when we declare riichi the HUD also shows the discards the model would
 * pick afterwards. It only exists because the engine answers a real hand, so it
 * is checked here rather than in the mapper (which only copies it across).
 *
 * The stream is a recorded sanma kyoku in which our seat declares riichi
 * (`akagi_20260422_203056.log`, kyoku 17). It comes from a v1.0.x log, but the
 * mjai vocabulary has not changed between versions, so the events feed the
 * current engine unchanged.
 */
import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';
import { hasEngineFor } from '../engine-availability.js';

interface SimCandidate {
  tile: string;
  confidence: number;
}

interface Recommendation {
  action: string;
  tile?: string;
  confidence: number;
  sim_candidates?: SimCandidate[];
}

const events: MJAIEvent[] = readFileSync(
  new URL('../fixtures/riichi.jsonl', import.meta.url),
  'utf8',
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as MJAIEvent);

const is3p = (events.find((event) => event.type === 'start_game') as { is_3p: boolean }).is_3p;

const TILE = /^([1-9][mps]|[ESWNPCF]|[1-9][mps]r)$/;
const LOOKAHEAD_CAP = 5;

describe.skipIf(!hasEngineFor(is3p))('a kyoku we declare riichi in', () => {
  /** Every recommendation row the HUD would have shown, in order. */
  let rows: Recommendation[] = [];

  beforeAll(async () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      for (const event of events) await engine.ingest([event]);
    } finally {
      engine.stop();
    }

    rows = messagesOn<{ recommendations: Recommendation[] }>('engine:recommendations').flatMap(
      (payload) => payload.recommendations ?? [],
    );
  }, 120_000);

  it('loads the model, otherwise the rest would be vacuous', () => {
    const models = messagesOn<{ model: string }>('engine:status').map((status) => status.model);

    expect(models).toContain('ready');
    expect(models).not.toContain('failed');
  });

  it('reaches a reach decision, otherwise the rest would be vacuous', () => {
    expect(rows.filter((row) => row.action === 'reach').length).toBeGreaterThan(0);
  });

  it('hangs the lookahead on the reach row and nowhere else', () => {
    const withLookahead = rows.filter((row) => row.sim_candidates?.length);

    expect(withLookahead.length).toBeGreaterThan(0);
    expect(withLookahead.every((row) => row.action === 'reach')).toBe(true);
    expect(
      rows.filter((row) => row.action === 'reach').every((row) => row.sim_candidates?.length),
    ).toBe(true);
  });

  it('names a real tile with a probability for every candidate', () => {
    const candidates = rows.flatMap((row) => row.sim_candidates ?? []);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.tile).toMatch(TILE);
      expect(candidate.confidence).toBeGreaterThan(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('ranks the candidates and caps them at the HUD row size', () => {
    for (const row of rows.filter((each) => each.sim_candidates?.length)) {
      const candidates = row.sim_candidates!;

      expect(candidates.length).toBeLessThanOrEqual(LOOKAHEAD_CAP);
      for (const [index, candidate] of candidates.entries()) {
        if (index === 0) continue;
        expect(candidates[index - 1].confidence).toBeGreaterThanOrEqual(candidate.confidence);
      }
    }
  });

  it('never suggests the same tile twice', () => {
    for (const row of rows.filter((each) => each.sim_candidates?.length)) {
      const tiles = row.sim_candidates!.map((candidate) => candidate.tile);

      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });

  it('picks the reach discard as the best candidate', () => {
    for (const row of rows.filter((each) => each.sim_candidates?.length)) {
      expect(row.sim_candidates![0].tile).toBe(row.tile);
    }
  });

  it('never lets the engine reject an event', () => {
    const notices = messagesOn<{ notice: { kind: string } | null }>('engine:status')
      .map((status) => status.notice?.kind)
      .filter(Boolean);

    expect(notices).not.toContain('runtime_error');
  });
});
