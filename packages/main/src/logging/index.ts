import { mkdirSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';
import type { LogLevel, LogMessage } from 'electron-log';
import log from 'electron-log/main';

export type { Logger } from 'electron-log';

/**
 * The electron-log levels the `log_level` setting accepts, least detailed first.
 * electron-log numbers them `error=0 … verbose=3, debug=4, silly=5` and writes a
 * message once its level is at or below the transport's, so a later entry here
 * keeps strictly more: `verbose` is the per-item game detail (packets, decisions,
 * HUD payloads) and `debug` adds the raw frames and internal noise. `silly` is
 * deliberately not offered.
 */
const LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug'];
const DEFAULT_LEVEL: LogLevel = 'info';

const FALLBACK_SCOPE = 'App';
const LOG_FILE_PREFIX = 'akagi_';
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatDate(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Renders the `time | LEVEL | module | message` line shared by the console and
 * the log file. Doing it in a transform keeps Error stacks and object arguments
 * readable and keeps both sinks byte-identical.
 */
function formatLine({ data, message }: { data: unknown[]; message: LogMessage }): string[] {
  const level = message.level.toUpperCase();
  const scope = message.scope || FALLBACK_SCOPE;
  const text = data.map(formatArg).join(' ');
  return [`${formatDate(message.date)} | ${level} | ${scope} | ${text}`];
}

// Both sinks are formatted up front, so even a line emitted before
// initializeLogger() runs is never written in electron-log's own format. The
// file sink stays off until a directory is configured.
log.transports.file.transforms = [formatLine];
log.transports.file.level = false;
log.transports.console.transforms = [formatLine];
log.transports.console.level = app.isPackaged ? false : DEFAULT_LEVEL;

/**
 * Sets the level for the log file, and for the console outside a packaged build.
 * Mirrors the `log_level` setting; unknown values keep the current level.
 */
export function setLogLevel(level: string) {
  const normalized = level?.toLowerCase() as LogLevel | undefined;
  if (!normalized || !LEVELS.includes(normalized)) return;

  log.transports.file.level = normalized;
  // A packaged Windows app has no console to write to.
  log.transports.console.level = app.isPackaged ? false : normalized;
}

/** Deletes log files older than the retention window. */
async function cleanupOldLogs(logsDir: string) {
  try {
    const files = await readdir(logsDir);
    const now = Date.now();

    for (const file of files) {
      const ours = file.startsWith(LOG_FILE_PREFIX);
      if (!ours || !file.endsWith('.log')) continue;

      const filePath = join(logsDir, file);
      const stats = await stat(filePath);
      if (now - stats.mtimeMs > RETENTION_MS) {
        await unlink(filePath).catch(() => {});
      }
    }
  } catch {
    // A missing or unreadable directory is not worth failing startup over.
  }
}

/**
 * Configures logging. Must run before the first log line; everything written
 * through {@link createLogger} afterwards lands in `logsDir/akagi_<timestamp>.log`.
 */
export function initializeLogger(logsDir: string, level?: string) {
  mkdirSync(logsDir, { recursive: true });

  const now = new Date();
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // The file transport appends synchronously, so nothing is lost on exit or
  // crash and no flush is needed.
  log.transports.file.resolvePathFn = () => join(logsDir, `${LOG_FILE_PREFIX}${timestamp}.log`);
  log.transports.file.maxSize = MAX_LOG_SIZE;
  setLogLevel(level ?? DEFAULT_LEVEL);

  // Without this an uncaught error in a windowed app leaves no trace at all.
  log.errorHandler.startCatching({ showDialog: false });
  log.eventLogger.startLogging({ scope: 'Events' });

  void cleanupOldLogs(logsDir);
}

/** Creates a module-scoped logger; the levels are electron-log's own. */
export function createLogger(module: string) {
  return log.scope(module);
}
