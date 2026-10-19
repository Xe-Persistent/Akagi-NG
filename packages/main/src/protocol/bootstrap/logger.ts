/**
 * Logging contract for the protocol bootstrap.
 *
 * The bootstrap runs both inside Electron (electron-log) and inside plain Node
 * (the `extract-liqi` CLI), so it only depends on this small structural
 * interface instead of a concrete logger.
 */
export interface BootstrapLogger {
  verbose(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export const silentLogger: BootstrapLogger = {
  verbose: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Logger that writes to the console, used by the CLI entry point. */
export const consoleLogger: BootstrapLogger = {
  verbose: (message, ...rest) => console.debug(message, ...rest),
  debug: (message, ...rest) => console.debug(message, ...rest),
  info: (message, ...rest) => console.info(message, ...rest),
  warn: (message, ...rest) => console.warn(message, ...rest),
  error: (message, ...rest) => console.error(message, ...rest),
};
