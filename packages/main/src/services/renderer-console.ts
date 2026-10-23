import type { BrowserWindow } from 'electron';

import { createLogger } from '../logging/index.js';

const logger = createLogger('Renderer');

/**
 * Renderer console levels folded onto ours: a normal run already keeps
 * warnings and errors, while `info`/`debug` land at `debug` so they only show
 * up when the log level asks for the most detail.
 */
const LEVELS = {
  error: 'error',
  warning: 'warn',
  info: 'debug',
  debug: 'debug',
} as const;

/**
 * Mirrors a window's `console.*` output into the log file, tagged with the
 * window name and the source location.
 *
 * Only our own windows are wired up. The game page has a far noisier console of
 * its own, and its load failures and crashes are already reported by the event
 * logger in `logging/`.
 */
export function forwardRendererConsole(win: BrowserWindow, label: string) {
  win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    logger[LEVELS[level]](`${label} | ${sourceId}:${lineNumber} | ${message}`);
  });
}
