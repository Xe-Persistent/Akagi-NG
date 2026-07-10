import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import { app, dialog } from 'electron';

import { createLogger } from './logger.js';

interface AppSettings {
  server?: {
    host?: string;
    port?: number;
  };
  mitm?: {
    host?: string;
    port?: number;
  };
}

import {
  BACKEND_READY_TIMEOUT_MS,
  BACKEND_SHUTDOWN_API_TIMEOUT_MS,
  BACKEND_SHUTDOWN_TIMEOUT_MS,
  BACKEND_STARTUP_CHECK_INTERVAL_MS,
  BACKEND_STARTUP_CHECK_RETRIES,
  BACKEND_STARTUP_CHECK_TIMEOUT_MS,
} from './constants.js';
import type { ResourceStatus } from './resource-validator.js';
import { ResourceValidator } from './resource-validator.js';
import { getAssetPath, getProjectRoot, isLoggingDisabled } from './utils.js';

const logger = createLogger('BackendManager');

export class BackendManager {
  private pyProcess: ChildProcess | null = null;
  private validator: ResourceValidator;
  private isReadyState: boolean = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason?: Error) => void;
  private isMockMode: boolean = false;

  private async getSettings(): Promise<AppSettings> {
    try {
      const settingsPath = getAssetPath('config', 'settings.json');
      const fileContent = await readFile(settingsPath, 'utf8');
      return JSON.parse(fileContent) as AppSettings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          'Failed to read settings.json for config:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return {};
  }

  public async getBackendConfig(): Promise<{ host: string; port: number }> {
    if (process.argv.includes('--mock')) {
      return { host: '127.0.0.1', port: 8765 };
    }
    const settings = await this.getSettings();
    return {
      host: settings.server?.host ?? '127.0.0.1',
      port: settings.server?.port ?? 8765,
    };
  }

  public async getMitmConfig(): Promise<{ host: string; port: number }> {
    const settings = await this.getSettings();
    return {
      host: settings.mitm?.host ?? '127.0.0.1',
      port: settings.mitm?.port ?? 6789,
    };
  }

  public isRunning(): boolean {
    if (this.isMockMode) return true;
    return !!this.pyProcess && !this.pyProcess.killed;
  }

  constructor() {
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyPromise.catch(() => {});

    this.validator = new ResourceValidator(getProjectRoot());
  }

  public async getResourceStatus(): Promise<ResourceStatus> {
    return await this.validator.validate();
  }

  public start() {
    if (this.pyProcess) {
      logger.info('Backend already running.');
      return;
    }

    const isDev = !app.isPackaged;

    if (process.argv.includes('--mock')) {
      this.isMockMode = true;
      this.startMockBackend();
    } else if (isDev) {
      this.startDevBackend();
    } else {
      this.startProdBackend();
    }
  }

  private startDevBackend() {
    logger.info('Starting Python backend in DEV mode...');

    const projectRoot = getProjectRoot();
    const backendRoot = join(projectRoot, 'akagi_backend');
    const venvDir = join(backendRoot, '.venv');

    let pythonExecutable: string;
    if (process.platform === 'win32') {
      pythonExecutable = join(venvDir, 'Scripts', 'python.exe');
    } else {
      pythonExecutable = join(venvDir, 'bin', 'python');
    }

    if (!existsSync(pythonExecutable)) {
      const errorMsg = `Python executable NOT FOUND at: ${pythonExecutable}. Please check your environment.`;
      logger.error(errorMsg);
      dialog.showErrorBox('Backend Initialization Failed', errorMsg);
      return;
    }

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: process.env.PYTHONPATH
        ? `${backendRoot}${delimiter}${process.env.PYTHONPATH}`
        : backendRoot,
    };

    this.pyProcess = spawn(pythonExecutable, ['-m', 'akagi_ng'], {
      cwd: projectRoot,
      env: env,
    });

    this.setupListeners();
    this.startHealthCheck();
  }

  private startMockBackend() {
    logger.info('Starting mock backend service...');
    this.markReady();
  }

  private startProdBackend() {
    logger.info('Starting Python backend service...');

    const isWin = process.platform === 'win32';
    const bundleDir = getAssetPath('bin');
    const pythonExecutable = join(bundleDir, 'python', isWin ? 'akagi-ng.exe' : 'bin/akagi-ng');

    if (!existsSync(pythonExecutable)) {
      const msg = `Portable Python not found at ${pythonExecutable}`;
      logger.error(msg);
      dialog.showErrorBox('Startup Error', msg);
      return;
    }

    try {
      this.pyProcess = spawn(pythonExecutable, ['-m', 'akagi_ng'], {
        cwd: getProjectRoot(),
        env: {
          ...process.env,
          PYTHONPATH: join(bundleDir, 'app_packages'),
          PYTHONUNBUFFERED: '1',
          AKAGI_NO_LOGS: isLoggingDisabled() ? '1' : process.env.AKAGI_NO_LOGS,
        },
      });

      this.setupListeners();
      this.startHealthCheck();
    } catch (e) {
      const msg = `Backend initialization failed: ${e instanceof Error ? e.message : String(e)}`;
      logger.error(msg);
      dialog.showErrorBox('Startup Error', msg);
    }
  }

  private async startHealthCheck() {
    try {
      for (let i = 0; i < BACKEND_STARTUP_CHECK_RETRIES; i++) {
        if (!this.isRunning()) {
          logger.warn('Backend process has stopped. Aborting readiness check.');
          break;
        }
        try {
          const { host, port } = await this.getBackendConfig();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), BACKEND_STARTUP_CHECK_TIMEOUT_MS);
          await fetch(`http://${host}:${port}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          logger.info(`Backend API is listening on port ${port}.`);
          this.markReady();
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, BACKEND_STARTUP_CHECK_INTERVAL_MS));
        }
      }
    } catch (err) {
      logger.warn('Backend health check terminated unexpectedly:', err);
    }
  }

  private setupListeners() {
    if (!this.pyProcess) return;

    this.pyProcess.on('error', (err) => {
      const msg = `Failed to execute backend process: ${err.message}`;
      logger.error(msg);
      dialog.showErrorBox('Backend Fatal Error', msg);
    });

    this.pyProcess.stderr?.on('data', (data) => {
      logger.error(`Backend stderr: ${data.toString().trim()}`);
    });

    this.pyProcess.on('close', (code) => {
      logger.info(`Backend service terminated with code ${code}`);
      this.pyProcess = null;
      if (!this.isReadyState) {
        this.rejectReady(new Error(`Backend service terminated with code ${code}`));
      }
    });
  }

  private markReady() {
    if (!this.isReadyState) {
      this.isReadyState = true;
      this.resolveReady();
      logger.info('Backend service initialization completed.');
    }
  }

  public async waitForReady(timeoutMs: number = BACKEND_READY_TIMEOUT_MS): Promise<boolean> {
    if (this.isReadyState) return true;

    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });

    return Promise.race([this.readyPromise.then(() => true).catch(() => false), timeoutPromise]);
  }

  public async stop() {
    if (!this.isRunning()) return;

    try {
      const { host, port } = await this.getBackendConfig();
      await fetch(`http://${host}:${port}/api/shutdown`, {
        method: 'POST',
        signal: AbortSignal.timeout(BACKEND_SHUTDOWN_API_TIMEOUT_MS),
      });
    } catch {
      // Ignore error, process might already be closing
    }

    await new Promise<void>((resolve) => {
      if (!this.pyProcess) return resolve();

      const timeout = setTimeout(() => {
        if (this.isRunning()) {
          logger.warn('Backend shutdown timed out, forcing termination.');
          this.pyProcess?.kill('SIGKILL');
        }
        resolve();
      }, BACKEND_SHUTDOWN_TIMEOUT_MS);

      this.pyProcess?.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.pyProcess = null;
  }
}
