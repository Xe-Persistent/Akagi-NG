import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';

import { BACKEND_SHUTDOWN_API_TIMEOUT_MS, BACKEND_SHUTDOWN_TIMEOUT_MS } from './constants';
import type { ResourceStatus } from './resource-validator';
import { ResourceValidator } from './resource-validator';
import { getAssetPath, getProjectRoot } from './utils';

export class BackendManager {
  private pyProcess: ChildProcess | null = null;
  private validator: ResourceValidator;
  private isReadyState: boolean = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  public getBackendConfig(): { host: string; port: number } {
    const defaultHost = '127.0.0.1';
    const defaultPort = 8765;

    try {
      const settingsPath = getAssetPath('config', 'settings.json');

      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return {
          host: settings?.server?.host || defaultHost,
          port: settings?.server?.port || defaultPort,
        };
      }
    } catch (err) {
      console.warn('[BackendManager] Failed to read settings.json for backend config:', err);
    }

    return { host: defaultHost, port: defaultPort };
  }

  public getMitmConfig(): { host: string; port: number } {
    const defaultHost = '127.0.0.1';
    const defaultPort = 6789;

    try {
      const settingsPath = getAssetPath('config', 'settings.json');

      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return {
          host: settings?.mitm?.host || defaultHost,
          port: settings?.mitm?.port || defaultPort,
        };
      }
    } catch (err) {
      console.warn('[BackendManager] Failed to read settings.json for mitm config:', err);
    }

    return { host: defaultHost, port: defaultPort };
  }

  public isRunning(): boolean {
    return !!this.pyProcess && !this.pyProcess.killed;
  }

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.validator = new ResourceValidator(getProjectRoot());
  }

  public getResourceStatus(): ResourceStatus {
    return this.validator.validate();
  }

  public start() {
    if (this.pyProcess) {
      console.log('Backend already running.');
      return;
    }

    const isDev = !app.isPackaged;

    if (process.env.AKAGI_MOCK_MODE === '1') {
      this.startMockBackend();
    } else if (isDev) {
      this.startDevBackend();
    } else {
      this.startProdBackend();
    }
  }

  private startDevBackend() {
    console.log('Starting backend in DEV mode...');

    const projectRoot = getProjectRoot();
    const backendRoot = path.join(projectRoot, 'akagi_backend');
    const venvDir = path.join(backendRoot, '.venv');

    let pythonExecutable: string;
    if (process.platform === 'win32') {
      pythonExecutable = path.join(venvDir, 'Scripts', 'python.exe');
    } else {
      pythonExecutable = path.join(venvDir, 'bin', 'python');
    }

    if (!fs.existsSync(pythonExecutable)) {
      const errorMsg = `Python executable NOT FOUND at: ${pythonExecutable}. Please check your environment.`;
      console.error(`[BackendManager] ${errorMsg}`);
      dialog.showErrorBox('Backend Initialization Failed', errorMsg);
      return;
    }

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      AKAGI_GUI_MODE: '1',
      PYTHONPATH:
        backendRoot + (process.platform === 'win32' ? ';' : ':') + (process.env.PYTHONPATH || ''),
    };

    this.pyProcess = spawn(pythonExecutable, ['-m', 'akagi_ng'], {
      cwd: projectRoot,
      env: env,
    });

    this.setupListeners();
  }

  private startMockBackend() {
    console.log('Starting backend in MOCK mode...');

    const projectRoot = getProjectRoot();
    const frontendRoot = path.join(projectRoot, 'akagi_frontend');
    const mockScript = path.join(frontendRoot, 'mock.ts');

    if (!fs.existsSync(mockScript)) {
      console.error(`[BackendManager] Mock script NOT FOUND at: ${mockScript}`);
      return;
    }

    const shell = process.platform === 'win32';
    this.pyProcess = spawn('npx', ['tsx', 'mock.ts'], {
      cwd: frontendRoot,
      shell: shell,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    });

    this.pyProcess.on('error', (err) => {
      console.error('Failed to spawn mock backend process:', err);
    });

    this.setupListeners();
  }

  private startProdBackend() {
    console.log('Starting backend in PROD mode...');

    const binaryName = process.platform === 'win32' ? 'akagi-ng.exe' : 'akagi-ng';
    const binaryPath = getAssetPath('bin', binaryName);

    if (!fs.existsSync(binaryPath)) {
      const msg = `Executable not found at ${binaryPath}`;
      console.error(`[BackendManager] ${msg}`);
      dialog.showErrorBox('Startup Error', msg);
      return;
    }

    try {
      this.pyProcess = spawn(binaryPath, [], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          AKAGI_GUI_MODE: '1',
        },
      });

      this.pyProcess.on('error', (err) => {
        const msg = `Failed to start backend process: ${err.message}`;
        console.error(`[BackendManager] ${msg}`);
        dialog.showErrorBox('Backend Error', msg);
      });

      this.setupListeners();
    } catch (e) {
      const msg = `Backend initialization failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`[BackendManager] ${msg}`);
      dialog.showErrorBox('Startup Error', msg);
    }
  }

  private setupListeners() {
    if (!this.pyProcess) return;

    this.pyProcess.stdout?.on('data', (data) => {
      console.log(`${data.toString().trim()}`);
    });

    this.pyProcess.stderr?.on('data', (data) => {
      console.error(`[Backend Error]: ${data.toString().trim()}`);
    });

    this.pyProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      this.pyProcess = null;
    });
  }

  public markReady() {
    if (!this.isReadyState) {
      this.isReadyState = true;
      this.resolveReady();
      console.log('[BackendManager] Backend is marked as READY.');
    }
  }

  public async waitForReady(timeoutMs: number = 20000): Promise<boolean> {
    if (this.isReadyState) return true;

    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });

    return Promise.race([this.readyPromise.then(() => true), timeoutPromise]);
  }

  public async stop() {
    if (!this.isRunning()) return;

    try {
      const { host, port } = this.getBackendConfig();
      await fetch(`http://${host}:${port}/api/shutdown`, {
        method: 'POST',
        signal: AbortSignal.timeout(BACKEND_SHUTDOWN_API_TIMEOUT_MS),
      });
    } catch {
      // Ignore error, process might already be closing
    }

    await new Promise<void>((resolve) => {
      if (!this.isRunning()) return resolve();

      const timeout = setTimeout(() => {
        if (this.isRunning()) {
          console.warn('[BackendManager] Shutdown timeout, forcing exit');
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
