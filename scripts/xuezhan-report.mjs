// Reports a xuezhan capture round by round: the deal, the swap, every win and the
// exhaustive draw with their settlements, and whether the capture finally contains
// an `ActionHuleXueZhanEnd` (the win that ends a blood battle, i.e. the third one).
//
//   node scripts/xuezhan-report.mjs logs/akagi_20261016_201928.log
//
// Reads a `log_level: "verbose"` capture; nothing else is needed.
import { readFileSync } from 'node:fs';

const [LOG] = process.argv.slice(2);
if (!LOG) throw new Error('usage: xuezhan-report.mjs <capture log>');

/** `time | VERBOSE | MajsoulBridge | [CDP] .lq.X Notify {json}` */
const DECODED = /^(\S+ \S+) \| VERBOSE \| \S+ \| \[(CDP|MITM)\] (\.\S+) (Notify|Req|Res) (\{.*)$/;
/** Actions the bridge has no mapping for are recorded at the capture level. */
const UNHANDLED = /Unhandled ActionPrototype: (\S+)/;

const rounds = [];
let end = null;
const unhandled = new Map();
const sources = new Set();
const text = readFileSync(LOG, 'utf8');

for (const line of text.split(/\r?\n/)) {
  const match = line.match(DECODED);
  if (match) {
    const [, time, source, method, , json] = match;
    if (method !== '.lq.ActionPrototype') continue;
    sources.add(source);
    const { name, data } = JSON.parse(json);
    const clock = time.slice(11);

    if (name === 'ActionNewRound') {
      rounds.push({
        clock,
        round: `${['東', '南', '西', '北'][data.chang]}${data.ju + 1}`,
        honba: data.ben,
        pot: data.liqibang,
        tiles: data.tiles.length,
        scores: data.scores,
        riichi: 0,
        wins: [],
        draw: null,
      });
    }

    const round = rounds.at(-1);
    if (!round) continue;

    if (name === 'ActionChangeTile') {
      round.swap = { in: data.inTiles, out: data.outTiles, doras: data.doras };
    }
    if (name === 'ActionDiscardTile' && data.isLiqi) round.riichi++;
    if (name === 'ActionHuleXueZhanMid' || name === 'ActionHuleXueZhanEnd') {
      for (const hule of data.hules ?? []) {
        round.wins.push({
          end: name.endsWith('End'),
          clock,
          seat: hule.seat,
          zimo: hule.zimo,
          tile: hule.huTile,
          han: hule.count,
          fu: hule.fu,
          deltas: data.deltaScores,
        });
      }
      if (name.endsWith('End')) end = { clock, round: round.round, data };
    }
    if (name === 'ActionNoTile') {
      round.draw = {
        clock,
        players: (data.players ?? []).map(
          (p) => `${p.tingpai ? 'tenpai' : 'noten'}${p.alreadyHule ? '+huled' : ''}`,
        ),
        deltas: data.scores?.[0]?.deltaScores,
        gameend: data.gameend,
      };
    }
  }

  const diag = line.match(UNHANDLED);
  if (diag) unhandled.set(diag[1], (unhandled.get(diag[1]) ?? 0) + 1);
}

console.log(`log: ${LOG}`);
console.log(`rounds: ${rounds.length}, capture source: ${[...sources].join(', ') || 'none'}`);
console.log(`decoded but not recorded: .lq.Route.heartbeat`);
console.log(
  `actions the bridge does not map yet: ${
    unhandled.size === 0
      ? '(none)'
      : [...unhandled].map(([name, count]) => `${name} x${count}`).join(', ')
  }`,
);

for (const round of rounds) {
  const pot = round.pot > 0 ? `, pot ${round.pot}` : '';
  const honba = round.honba > 0 ? `, honba ${round.honba}` : '';
  console.log(
    `\n=== ${round.round} @ ${round.clock} (scores ${JSON.stringify(round.scores)}${honba}${pot}) ===`,
  );
  console.log(
    `  deal: ${round.tiles} tile(s)  swap: ${round.swap ? `${round.swap.out.join('+')} -> ${round.swap.in.join('+')} (dora ${round.swap.doras.join('+')})` : '(none)'}${round.riichi > 0 ? `  riichi x${round.riichi}` : ''}`,
  );

  for (const win of round.wins) {
    const seat = `${win.seat}${win.end ? ' (ends the round)' : ''}`;
    console.log(
      `  win @ ${win.clock}: seat ${seat} ${win.zimo ? 'tsumo' : 'ron'} ${win.tile} (${win.han} han ${win.fu} fu) deltas ${JSON.stringify(win.deltas)}`,
    );
  }

  if (round.draw) {
    console.log(
      `  draw @ ${round.draw.clock}: ${round.draw.players.join(' ')} deltas ${JSON.stringify(round.draw.deltas)} (gameend: ${round.draw.gameend})`,
    );
  } else {
    console.log('  draw: (the round was ended by something else)');
  }
}

console.log('');
if (end) {
  console.log(`ACTIONHULEXUEZHANEND FOUND in ${end.round} @ ${end.clock} -- here is its payload:`);
  console.log(JSON.stringify(end.data, null, 1));
} else {
  console.log('no ActionHuleXueZhanEnd in this capture yet (it needs three winners in one round).');
}
