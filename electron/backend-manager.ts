import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';

import type { ResourceStatus } from './resource-validator';
import { ResourceValidator } from './resource-validator';

export class BackendManager {
  private pyProcess: ChildProcess | null = null;
  private readonly HOST = '127.0.0.1';
  private readonly PORT = 8765; // Default port used by backend
  private validator: ResourceValidator;

  constructor() {
    // In dev, root is ../../ from dist/main
    // In prod, root is process.resourcesPath or app.getAppPath()
    const projectRoot = !app.isPackaged
      ? path.resolve(__dirname, '../../')
      : path.join(process.resourcesPath, '..');
    this.validator = new ResourceValidator(projectRoot);
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

    // Path resolution
    // __dirname is .../dist/main
    const projectRoot = path.resolve(__dirname, '../../'); // .../dist/main/../../ -> project root
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

    // Run module: python -m akagi_ng
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

    const projectRoot = path.resolve(__dirname, '../../');
    const frontendRoot = path.join(projectRoot, 'akagi_frontend');
    const mockScript = path.join(frontendRoot, 'mock.ts');

    if (!fs.existsSync(mockScript)) {
      console.error(`[BackendManager] Mock script NOT FOUND at: ${mockScript}`);
      return;
    }

    // Use npx tsx to run the mock script
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
    const binaryPath = path.join(path.join(process.resourcesPath, '..'), 'bin', binaryName);

    console.log(`Backend Binary: ${binaryPath}`);

    this.pyProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    this.setupListeners();
  }

  private setupListeners() {
    if (!this.pyProcess) return;

    this.pyProcess.stdout?.on('data', (data) => {
      console.log(`[Backend]: ${data.toString().trim()}`);
    });

    this.pyProcess.stderr?.on('data', (data) => {
      console.error(`[Backend ERROR]: ${data.toString().trim()}`);
    });

    this.pyProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      this.pyProcess = null;
    });
  }

  public stop() {
    if (this.pyProcess) {
      console.log('Stopping backend process...');
      this.pyProcess.kill();
      this.pyProcess = null;
    }
  }
}
