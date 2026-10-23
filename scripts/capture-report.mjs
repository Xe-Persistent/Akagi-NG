// Surveys a capture: which liqi messages and game actions a real session carried,
// which actions the bridge has no mapping for yet, and how the round boundaries
// looked. The first thing to run on a capture that does not decode.
//
//   node scripts/capture-report.mjs <log path>
//
// The log must have been recorded with `log_level: "debug"`, which logs every
// decoded message the bridge sees, except the game websocket's heartbeat.
import { readFileSync } from 'node:fs';

const LOG = process.argv[2];
if (!LOG) throw new Error('usage: capture-report.mjs <log path>');

/** Decoded but not recorded, so its absence below is expected. */
const UNRECORDED = ['.lq.Route.heartbeat'];

/** `time | DEBUG | MajsoulBridge | [MITM] .lq.X Notify {json}` */
const DECODED = /^(\S+ \S+) \| DEBUG \| \S+ \| \[(CDP|MITM)\] (\.\S+) (Notify|Req|Res) (\{.*)$/;
/** The bridge logs the actions it has no handler for. */
const UNHANDLED = /Unhandled ActionPrototype: (\S+)/;
/** Frames whose protobuf decode failed are dropped, and must not go unnoticed. */
const UNDECODED = /Decode skipped/;

/** Round boundaries plus the xuezhan actions, if the session had any. */
const TIMELINE_ACTIONS = new Set([
  'ActionMJStart',
  'ActionNewRound',
  'ActionChangeTile',
  'ActionHuleXueZhanMid',
  'ActionHuleXueZhanEnd',
  'ActionHule',
  'ActionNoTile',
  'ActionLiuJu',
]);

const text = readFileSync(LOG, 'utf8');
const entries = [];
const broken = [];

for (const line of text.split(/\r?\n/)) {
  const match = line.match(DECODED);
  if (!match) continue;

  try {
    entries.push({
      timestamp: match[1],
      source: match[2],
      method: match[3],
      type: match[4],
      data: JSON.parse(match[5]),
    });
  } catch {
    broken.push(line);
  }
}

const methods = new Map();
const actions = new Map();
const unhandled = new Map();
const timeline = [];

for (const entry of entries) {
  methods.set(entry.method, (methods.get(entry.method) ?? 0) + 1);
  const name = entry.method === '.lq.ActionPrototype' ? entry.data?.name : undefined;
  if (!name) continue;

  actions.set(name, (actions.get(name) ?? 0) + 1);
  if (TIMELINE_ACTIONS.has(name)) timeline.push({ ...entry, name });
}

for (const line of text.split(/\r?\n/)) {
  const match = line.match(UNHANDLED);
  if (match) unhandled.set(match[1], (unhandled.get(match[1]) ?? 0) + 1);
}

const section = (title) => console.log(`\n=== ${title} ===`);
const histogram = (entriesToSort) => [...entriesToSort].sort((a, b) => b[1] - a[1]);
const sources = [...new Set(entries.map((entry) => entry.source))];

console.log(`log: ${LOG}`);
console.log(
  `decoded messages: ${entries.length}` +
    ` (source: ${sources.join(', ') || 'none'}), unparsable lines: ${broken.length}`,
);
console.log(`frames the protocol could not decode: ${(text.match(UNDECODED) ?? []).length}`);
console.log(`decoded but not recorded: ${UNRECORDED.join(', ')}`);

section('liqi methods');
for (const [method, count] of histogram(methods))
  console.log(`  ${String(count).padStart(5)}  ${method}`);

section('game actions');
for (const [name, count] of histogram(actions))
  console.log(`  ${String(count).padStart(5)}  ${name}`);

section('actions the bridge does not map yet');
if (unhandled.size === 0) console.log('  (none: every action produced at least one event)');
for (const [name, count] of histogram(unhandled))
  console.log(`  ${String(count).padStart(5)}  ${name}`);

section('round boundaries and possible xuezhan actions');
if (timeline.length === 0) console.log('  (none)');
for (const entry of timeline) {
  const detail = summarize(entry.name, entry.data);
  console.log(`  ${entry.timestamp} ${entry.source} ${entry.name} ${detail}`.trimEnd());
}

/** Key fields of the round-boundary actions, i.e. what phase 1 has to answer. */
function summarize(name, data) {
  const record = data?.data ?? {};
  const json = (value) => JSON.stringify(value ?? null);
  switch (name) {
    case 'ActionNewRound':
      return `tiles=${(record.tiles ?? []).length} chang=${record.chang} ju=${record.ju} ben=${record.ben} dora=${record.dora ?? '-'} scores=${json(record.scores)}`;
    case 'ActionChangeTile':
      return `in=${json(record.inTiles)} out=${json(record.outTiles)} dora=${record.doras?.[0] ?? '-'}`;
    case 'ActionHuleXueZhanMid':
    case 'ActionHuleXueZhanEnd':
      return `hules=${json(
        (record.hules ?? []).map((h) => ({ seat: h.seat, zimo: h.zimo, tile: h.huTile })),
      )} delta=${json(record.deltaScores)}`;
    case 'ActionHule':
      return `hules=${(record.hules ?? []).length} delta=${json(record.deltaScores)} gameend=${record.gameend ? 'yes' : 'no'}`;
    case 'ActionNoTile':
      return `players=${json(
        (record.players ?? []).map((p) => ({ tingpai: p.tingpai, alreadyHule: p.alreadyHule })),
      )}`;
    default:
      return '';
  }
}
