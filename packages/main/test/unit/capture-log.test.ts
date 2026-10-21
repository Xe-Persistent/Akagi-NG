/**
 * What a capture keeps. A log written at `verbose` is the only offline window
 * into a real game, so what it records -- and what it deliberately leaves out --
 * is a contract, not an implementation detail.
 */
import type { LogLevel } from 'electron-log';
import log from 'electron-log/main';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import { actionFrame, encodeMessage, notifyFrame, requestFrame } from '../liqi-frames.js';
import { actions } from '../real-packets.js';

const written: string[] = [];
const originalWriteFn = log.transports.console.writeFn;

/**
 * One captured line. The logger prefixes the time, the level and the module, so
 * the capture shape starts after the third separator.
 */
const CAPTURE = /^\S+ \S+ \| \w+ \| \S+ \| \[(CDP|MITM)\] (\.\S+) (\w+) (\{.*)$/;

beforeAll(() => {
  log.transports.file.level = false;
  log.transports.console.writeFn = ({ message }) => written.push(message.data.join(' '));
});

afterAll(() => {
  log.transports.console.writeFn = originalWriteFn;
});

/**
 * `setLogLevel` leaves the console sink off in a packaged build, which the stub
 * reports; the level contract itself is covered in `logging.test.ts`, so this
 * drives the console transport directly.
 */
function captureAt(level: LogLevel) {
  written.length = 0;
  log.transports.console.level = level;
}

/** Lines that are a captured message rather than a diagnostic. */
const captures = () => written.filter((line) => CAPTURE.test(line));

const newRound = actions.find((packet) => packet.name === 'ActionNewRound')!;

describe('a verbose capture', () => {
  it('writes one line per decoded message, with the source that saw it', () => {
    captureAt('verbose');
    new MajsoulBridge().parse(actionFrame(newRound.name, newRound.fields), 'CDP');

    expect(captures()).toHaveLength(1);
    const [, source, method, type, json] = captures()[0]!.match(CAPTURE)!;
    expect(source).toBe('CDP');
    expect(method).toBe('.lq.ActionPrototype');
    expect(type).toBe('Notify');
    expect(JSON.parse(json!)).toMatchObject({ name: 'ActionNewRound' });
  });

  it('keeps every field of the message, not a summary', () => {
    captureAt('verbose');
    new MajsoulBridge().parse(actionFrame(newRound.name, newRound.fields), 'MITM');

    const [, , , , json] = captures()[0]!.match(CAPTURE)!;
    const decoded = JSON.parse(json!) as { data: Record<string, unknown> };
    const wire = newRound.fields;

    // The log uses the camelCase names the bridge works in, while the fixture
    // keeps the descriptor's own -- so compare what the values say.
    expect(decoded.data.tiles).toEqual(wire.tiles);
    expect(decoded.data.scores).toEqual(wire.scores);
    expect(decoded.data.chang).toBe(wire.chang);
    expect(decoded.data.ju).toBe(wire.ju);
  });

  it('leaves the heartbeat out', () => {
    captureAt('verbose');
    new MajsoulBridge().parse(notifyFrame('.lq.Route.heartbeat', Buffer.alloc(0)), 'CDP');

    expect(captures()).toHaveLength(0);
  });

  it('adds the raw bytes only at debug', () => {
    const frame = actionFrame(newRound.name, newRound.fields);

    captureAt('verbose');
    new MajsoulBridge().parse(frame, 'CDP');
    expect(written.some((line) => line.includes(frame.toString('hex')))).toBe(false);

    captureAt('debug');
    new MajsoulBridge().parse(frame, 'CDP');
    expect(written.some((line) => line.includes(frame.toString('hex')))).toBe(true);
  });

  it('reports an action the bridge does not map', () => {
    captureAt('verbose');
    // A name this build has no descriptor for: the wrapper carries it, the
    // payload is something the bridge can only report on.
    const unknown = notifyFrame(
      '.lq.ActionPrototype',
      encodeMessage('ActionPrototype', {
        name: 'ActionSomethingFromAFutureBuild',
        data: Buffer.alloc(0),
      }),
    );
    new MajsoulBridge().parse(unknown, 'CDP');

    expect(
      written.some((line) =>
        line.includes('Unhandled ActionPrototype: ActionSomethingFromAFutureBuild'),
      ),
    ).toBe(true);
  });

  it('records nothing for a frame it cannot decode', () => {
    captureAt('verbose');
    const garbled = notifyFrame('.lq.ActionMJStart', Buffer.from([0xff, 0xff, 0xff, 0xff]));
    const output = new MajsoulBridge().parse(garbled, 'CDP');

    expect(output.parseFailed).toBe(true);
    expect(captures()).toHaveLength(0);
  });

  it('keeps a decoded request apart from its diagnostic lines', () => {
    captureAt('verbose');

    new MajsoulBridge().parse(requestFrame('.lq.FastTest.authGame', 1, Buffer.alloc(0)), 'MITM');

    expect(captures()).toHaveLength(1);
    const [, source, method, type] = captures()[0]!.match(CAPTURE)!;
    expect({ source, method, type }).toEqual({
      source: 'MITM',
      method: '.lq.FastTest.authGame',
      type: 'Req',
    });
  });
});
