/**
 * Real action packets, pulled from a recorded capture and stored in descriptor
 * field names. Synthesised frames only carry the fields the test author thought
 * of; these carry everything the game actually sends, including fields this
 * build of the protocol does not know.
 *
 * `actions.jsonl` holds one of each shape. `round.jsonl` holds one complete
 * round in order -- a blood-battle deal with the three-tile swap, two mid-game
 * wins that do not end it, and an exhaustive draw that does.
 */
import { readFileSync } from 'node:fs';

import { MajsoulBridge } from '../src/protocol/majsoul/bridge.js';
import { actionFrame } from './liqi-frames.js';

export interface RealPacket {
  name: string;
  fields: Record<string, unknown>;
}

function readFixture(name: string): RealPacket[] {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RealPacket);
}

export const actions = readFixture('actions.jsonl');
export const round = readFixture('round.jsonl');

/** Replays packets through one bridge, the way the capture layer would. */
export function replay(packets: RealPacket[]): {
  bridge: MajsoulBridge;
  events: ReturnType<MajsoulBridge['parse']>['events'];
  failures: string[];
} {
  const bridge = new MajsoulBridge();
  const events: ReturnType<MajsoulBridge['parse']>['events'] = [];
  const failures: string[] = [];

  for (const packet of packets) {
    const output = bridge.parse(actionFrame(packet.name, packet.fields), 'CDP');
    if (output.parseFailed) failures.push(packet.name);
    events.push(...output.events);
  }

  return { bridge, events, failures };
}
