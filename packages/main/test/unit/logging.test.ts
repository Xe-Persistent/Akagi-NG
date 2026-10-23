import log from 'electron-log/main';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, setLogLevel } from '../../src/logging/index.js';
import { app } from '../electron-stub.js';

/** The ladder the `log_level` setting moves along, least detailed first. */
const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/** What the console sink was handed: the level, and the rendered line. */
const written: { level: string; line: string }[] = [];
const originalWriteFn = log.transports.console.writeFn;

/**
 * `app.isPackaged` gates the console transport, and the stub reports a packaged
 * build so a stray console sink cannot pollute the test output. Reporting an
 * unpackaged one puts the console transport back in the picture, where a write
 * function can record what each level lets through.
 */
beforeAll(() => {
  app.isPackaged = false;
  log.transports.file.level = false;
  log.transports.console.writeFn = ({ message }) =>
    written.push({ level: message.level, line: message.data.join(' ') });
});

afterAll(() => {
  app.isPackaged = true;
  log.transports.console.writeFn = originalWriteFn;
});

beforeEach(() => {
  written.length = 0;
});

function emit(): void {
  const logger = createLogger('Test');
  for (const level of LEVELS) logger[level]('x');
}

describe('the log level setting', () => {
  it('keeps exactly the levels up to itself', () => {
    for (const [index, level] of LEVELS.entries()) {
      written.length = 0;
      setLogLevel(level);
      emit();

      expect([...new Set(written.map((entry) => entry.level))], `at "${level}"`).toEqual(
        LEVELS.slice(0, index + 1),
      );
    }
  });

  it('never drops anything a lower level keeps', () => {
    const kept: Record<string, string[]> = {};
    for (const level of LEVELS) {
      written.length = 0;
      setLogLevel(level);
      emit();
      kept[level] = written.map((entry) => entry.level);
    }

    for (const [index, level] of LEVELS.entries()) {
      const below = LEVELS[index - 1];
      if (!below) continue;
      for (const each of kept[below]!) expect(kept[level]!).toContain(each);
    }
  });

  it('leaves the setting alone when the value is not a level', () => {
    setLogLevel('debug');
    setLogLevel('nonsense');

    written.length = 0;
    createLogger('Test').debug('x');

    expect(written).toHaveLength(1);
  });
});

describe('a rendered line', () => {
  it('carries the time, the level and the module', () => {
    setLogLevel('info');
    written.length = 0;

    createLogger('Liqi').info('protocol loaded');

    expect(written[0]!.line).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| INFO \| Liqi \| protocol loaded$/,
    );
  });

  it('renders an object argument as JSON and keeps an error stack readable', () => {
    setLogLevel('info');
    written.length = 0;

    const logger = createLogger('Test');
    logger.info({ a: 1 });
    logger.info(new Error('boom'));

    expect(written[0]!.line).toMatch(/\| \{"a":1\}$/);
    // The stack follows the message, so a log line is several lines long.
    expect(written[1]!.line.split('\n')[0]).toMatch(/\| Error: boom$/);
    expect(written[1]!.line.split('\n').length).toBeGreaterThan(1);
  });
});
