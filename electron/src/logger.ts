import type { WriteStream } from 'node:fs';
import { appendFileSync, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

let fileStream: WriteStream | null = null;
let logFilePath: string = '';
let currentBytesWritten = 0;
let currentLogsDir = '';
let loggingEnabled = true;

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

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

function writeToFile(line: string) {
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
    originalConsole.log(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile(formatLogLine('INFO', module, cleanMsg, args));
  };

  console.info = (message?: unknown, ...args: unknown[]) => {
    originalConsole.info(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile(formatLogLine('INFO', module, cleanMsg, args));
  };

  console.warn = (message?: unknown, ...args: unknown[]) => {
    originalConsole.warn(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile(formatLogLine('WARN', module, cleanMsg, args));
  };

  console.error = (message?: unknown, ...args: unknown[]) => {
    originalConsole.error(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile(formatLogLine('ERROR', module, cleanMsg, args));
  };

  console.debug = (message?: unknown, ...args: unknown[]) => {
    originalConsole.debug(message, ...args);
    const { module, cleanMsg } = parseModule(message, 'Electron');
    writeToFile(formatLogLine('DEBUG', module, cleanMsg, args));
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
export function initializeLogger(logsDir: string, enabled: boolean = true) {
  loggingEnabled = enabled;
  if (!enabled) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
    console.debug = () => {};
    return;
  }

  currentLogsDir = logsDir;
  rotateLogFile(); // 初始化第一个文件

  // 1. 注入补丁
  patchConsole();

  // 2. 注册优雅退出处理器
  process.on('exit', () => {
    if (fileStream) {
      fileStream.end();
      fileStream = null;
    }
  });

  // 3. 异步清理旧日志
  cleanupOldLogs(logsDir);
}

/**
 * 工厂函数：创建一个具备模块隔离前缀的结构化 Logger
 */
export function createLogger(module: string): Logger {
  return {
    debug: (message: string, ...args: unknown[]) => {
      if (!loggingEnabled) return;
      originalConsole.debug(`[${module}] ${message}`, ...args);
      writeToFile(formatLogLine('DEBUG', module, message, args));
    },
    info: (message: string, ...args: unknown[]) => {
      if (!loggingEnabled) return;
      originalConsole.info(`[${module}] ${message}`, ...args);
      writeToFile(formatLogLine('INFO', module, message, args));
    },
    warn: (message: string, ...args: unknown[]) => {
      if (!loggingEnabled) return;
      originalConsole.warn(`[${module}] ${message}`, ...args);
      writeToFile(formatLogLine('WARN', module, message, args));
    },
    error: (message: string, ...args: unknown[]) => {
      if (!loggingEnabled) return;
      originalConsole.error(`[${module}] ${message}`, ...args);
      writeToFile(formatLogLine('ERROR', module, message, args));
    },
  };
}
