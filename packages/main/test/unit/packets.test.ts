import { describe, expect, it } from 'vitest';

import { actions, replay } from '../real-packets.js';

/** What each real packet turns into, replayed on its own. */
const EXPECTED: Record<string, string[]> = {
  ActionMJStart: [],
  ActionDealTile: ['tsumo'],
  ActionDiscardTile: ['dahai'],
  ActionChiPengGang: ['chi'],
  ActionChangeTile: ['dora'],
  ActionHule: ['hora', 'end_kyoku'],
  ActionHuleXueZhanMid: ['hora'],
  ActionHuleXueZhanEnd: ['hora', 'end_kyoku'],
  ActionNoTile: ['ryukyoku', 'end_kyoku'],
};

/** A tile the bridge could not convert comes out as the unknown code. */
const UNKNOWN = '?';

/**
 * The dealer is dealt 14 tiles -- the hand plus the tile they already drew, which
 * comes out as a `tsumo`; everyone else gets 13 and no draw.
 */
function expectedFor(packet: { name: string; fields: Record<string, unknown> }): string[] {
  if (packet.name !== 'ActionNewRound') return EXPECTED[packet.name] ?? [];

  return (packet.fields.tiles as string[]).length === 14
    ? ['start_kyoku', 'tsumo']
    : ['start_kyoku'];
}

describe('a real action packet', () => {
  it.each(
    actions.map(
      (packet) => [`${packet.name} (${expectedFor(packet).length} event)`, packet] as const,
    ),
  )('%s converts', (_label, packet) => {
    const { events, failures } = replay([packet]);

    expect(failures).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(expectedFor(packet));
  });

  it('carries the draw the dealer already made as its fourteenth tile', () => {
    // `ActionNewRound` deals 14 tiles to the dealer and 13 to everyone else; the
    // last tile is the one they drew, not one to sort into the hand.
    const deals = actions.filter((packet) => packet.name === 'ActionNewRound');
    const dealer = deals.find((packet) => (packet.fields.tiles as string[]).length === 14);
    const others = deals.find((packet) => (packet.fields.tiles as string[]).length === 13);

    expect(dealer).toBeDefined();
    expect(others).toBeDefined();

    expect(replay([dealer!]).events.map((event) => event.type)).toEqual(['start_kyoku', 'tsumo']);
    expect(replay([others!]).events.map((event) => event.type)).toEqual(['start_kyoku']);
  });

  it('keeps a mid-game win from ending the round', () => {
    const mid = actions.find((packet) => packet.name === 'ActionHuleXueZhanMid')!;
    const end = actions.find((packet) => packet.name === 'ActionHuleXueZhanEnd')!;

    expect(replay([mid]).events.some((event) => event.type === 'end_kyoku')).toBe(false);
    expect(replay([end]).events.at(-1)?.type).toBe('end_kyoku');
  });

  it('carries the payments a win settled', () => {
    for (const packet of actions.filter((each) => each.name.includes('Hule'))) {
      const [hora] = replay([packet]).events.filter((event) => event.type === 'hora');
      const deltas = (packet.fields.delta_scores ??
        (packet.fields as { scores?: unknown }).scores) as number[][] | undefined;

      expect(hora).toBeDefined();
      if (deltas && hora) expect(Array.isArray(hora.deltas)).toBe(true);
    }
  });

  it('carries the table after a plain four-player win', () => {
    // `logs/akagi_20261019_130714.log`: a rinshan tsumo, kept here because it is
    // the only plain win in the fixtures and it settles which score array the
    // event must carry.
    const packet = actions.find((each) => each.name === 'ActionHule')!;
    const [hora] = replay([packet]).events;

    expect(hora).toMatchObject({ type: 'hora', deltas: packet.fields.delta_scores });
    expect((hora as { scores: number[] }).scores).toEqual(
      (packet.fields.delta_scores as number[]).map(
        (delta, seat) => (packet.fields.old_scores as number[])[seat]! + delta,
      ),
    );
  });

  it('never loses a tile the table can see', () => {
    const seen = replay(actions).events.filter(
      (event) => event.type === 'dahai' || event.type === 'tsumo',
    );

    for (const event of seen) {
      const pai = (event as { pai: string }).pai;
      expect(pai).not.toBe(UNKNOWN);
      expect(pai).toMatch(/^([1-9][mps]|[ESWNPCF]|5[mps]r)$/);
    }
  });
});
