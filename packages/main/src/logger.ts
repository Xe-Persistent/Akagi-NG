import type { WriteStream } from 'node:fs';
import { appendFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Accepts the level names used by the settings file (WARNING == WARN). */
const LEVEL_RANKS: Record<string, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  WARNING: 40,
  ERROR: 50,
};

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

let fileStream: WriteStream | null = null;
let logFilePath: string = '';
let currentBytesWritten = 0;
let currentLogsDir = '';
let currentLevelRank = LEVEL_RANKS.INFO;

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Sets the minimum level written to the log file. Mirrors the `log_level`
 * setting; unknown values keep the current level.
 */
export function setLogLevel(level: string) {
  const rank = LEVEL_RANKS[level?.toUpperCase?.() ?? ''];
  if (rank !== undefined) {
    currentLevelRank = rank;
  }
}

function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_RANKS[level] >= currentLevelRank;
}

// 保存原始的 console 方法引用
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

function formatLogLine(level: LogLevel, module: string, message: string, args: unknown[]): string {
  const timeStr = formatDate(new Date());

  let formattedArgs = '';
  if (args.length > 0) {
    formattedArgs =
      ' ' +
      args
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');
  }

  return `${timeStr} | ${level.padEnd(5)} | ${module} | ${message}${formattedArgs}\n`;
}

function writeToFile(level: LogLevel, line: string) {
  if (!isLevelEnabled(level)) return;

  if (fileStream) {
    fileStream.write(line);
    currentBytesWritten += Buffer.byteLength(line, 'utf8');

    if (currentBytesWritten > MAX_LOG_SIZE) {
      rotateLogFile();
    }
  } else if (logFilePath) {
    // 降级处理：如果流被关闭（例如在退出期间），使用同步写入保证日志不丢失
    try {
      appendFileSync(logFilePath, line);
    } catch {
      // 静默失败
    }
  }
}

function rotateLogFile() {
  if (fileStream) {
    fileStream.end();
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = new Date();
  const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  logFilePath = join(currentLogsDir, `electron_${timestamp}.log`);
  fileStream = createWriteStream(logFilePath, { flags: 'a' });
  currentBytesWritten = 0;
}

/**
 * 拦截全局 console 方法，自动提取 [Tag] 并写入文件
 */
function patchConsole() {
  const parseModule = (
    msg: unknown,
    defaultModule: string,
  ): { module: string; cleanMsg: string } => {
    if (typeof msg === 'string') {
      const match = msg.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        return { module: match[1], cleanMsg: match[2] };
      }
    }
    return { module: defaultModule, cleanMsg: String(msg) };
  };

  console.log = (message?: unknown, ...args: unknown[]) => {
    if (!isLevelEnabled('INFO')) return;
    originalConsole.log(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile('INFO', formatLogLine('INFO', module, cleanMsg, args));
  };

  console.info = (message?: unknown, ...args: unknown[]) => {
    if (!isLevelEnabled('INFO')) return;
    originalConsole.info(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile('INFO', formatLogLine('INFO', module, cleanMsg, args));
  };

  console.warn = (message?: unknown, ...args: unknown[]) => {
    if (!isLevelEnabled('WARN')) return;
    originalConsole.warn(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile('WARN', formatLogLine('WARN', module, cleanMsg, args));
  };

  console.error = (message?: unknown, ...args: unknown[]) => {
    if (!isLevelEnabled('ERROR')) return;
    originalConsole.error(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile('ERROR', formatLogLine('ERROR', module, cleanMsg, args));
  };

  console.debug = (message?: unknown, ...args: unknown[]) => {
    if (!isLevelEnabled('DEBUG')) return;
    originalConsole.debug(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile('DEBUG', formatLogLine('DEBUG', module, cleanMsg, args));
  };
}

/**
 * 后台清理超过指定天数的旧日志文件
 */
async function cleanupOldLogs(logsDir: string) {
  try {
    const files = await readdir(logsDir);
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith('electron_') && file.endsWith('.log')) {
        const filePath = join(logsDir, file);
        const stats = await stat(filePath);
        if (now - stats.mtimeMs > THIRTY_DAYS_MS) {
          await unlink(filePath).catch(() => {});
        }
      }
    }
  } catch {
    // 忽略目录读取错误
  }
}

/**
 * 初始化日志系统（必须在应用程序生命周期尽早调用）
 */
export function initializeLogger(logsDir: string, level?: string) {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  if (level) {
    setLogLevel(level);
  }

  currentLogsDir = logsDir;
  rotateLogFile(); // 初始化第一个文件

  // 1. 注入补丁
  patchConsole();

  // 2. 注册优雅退出处理器（beforeExit 里可以等待 flush，exit 只作兜底）
  process.on('beforeExit', () => {
    void flushLogs();
  });
  process.on('exit', () => {
    fileStream?.end();
    fileStream = null;
  });

  // 3. 异步清理旧日志
  cleanupOldLogs(logsDir);
}

/** Closes the log stream, waiting for buffered lines to be flushed. */
export async function flushLogs(): Promise<void> {
  const stream = fileStream;
  if (!stream) return;

  fileStream = null;
  await new Promise<void>((resolve) => stream.end(() => resolve()));
}

/**
 * 工厂函数：创建一个具备模块隔离前缀的结构化 Logger
 */
export function createLogger(module: string): Logger {
  return {
    trace: (message: string, ...args: unknown[]) => {
      if (!isLevelEnabled('TRACE')) return;
      originalConsole.debug(`[${module}] ${message}`, ...args);
      writeToFile('TRACE', formatLogLine('TRACE', module, message, args));
    },
    debug: (message: string, ...args: unknown[]) => {
      if (!isLevelEnabled('DEBUG')) return;
      originalConsole.debug(`[${module}] ${message}`, ...args);
      writeToFile('DEBUG', formatLogLine('DEBUG', module, message, args));
    },
    info: (message: string, ...args: unknown[]) => {
      if (!isLevelEnabled('INFO')) return;
      originalConsole.info(`[${module}] ${message}`, ...args);
      writeToFile('INFO', formatLogLine('INFO', module, message, args));
    },
    warn: (message: string, ...args: unknown[]) => {
      if (!isLevelEnabled('WARN')) return;
      originalConsole.warn(`[${module}] ${message}`, ...args);
      writeToFile('WARN', formatLogLine('WARN', module, message, args));
    },
    error: (message: string, ...args: unknown[]) => {
      if (!isLevelEnabled('ERROR')) return;
      originalConsole.error(`[${module}] ${message}`, ...args);
      writeToFile('ERROR', formatLogLine('ERROR', module, message, args));
    },
  };
}
