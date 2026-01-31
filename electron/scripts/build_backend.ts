import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Robust backend build script that finds the correct Python executable
 */
function buildBackend() {
  try {
    const electronDir = path.resolve(__dirname, '..');
    const projectRoot = path.resolve(electronDir, '..');
    const backendDir = path.join(projectRoot, 'akagi_backend');
    const buildScript = path.join(backendDir, 'scripts', 'build_backend.py');

    console.log('🔍 Identifying Python executable...');

    // Try local .venv first (for local development convenience)
    let pythonPath = 'python'; // Default to system PATH
    const venvPythonExec =
      process.platform === 'win32'
        ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
        : path.join(backendDir, '.venv', 'bin', 'python');

    if (fs.existsSync(venvPythonExec)) {
      pythonPath = venvPythonExec;
      console.log(`✅ Using virtual environment: ${pythonPath}`);
    } else {
      console.log('ℹ️ Virtual environment not found, falling back to system "python"');
    }

    console.log(`🚀 Running backend build script: ${buildScript}`);

    const result = spawnSync(pythonPath, [buildScript], {
      cwd: electronDir,
      stdio: 'inherit',
      shell: false,
    });

    if (result.status !== 0) {
      console.error(`❌ Backend build failed with exit code ${result.status}`);
      process.exit(result.status || 1);
    }

    console.log('✅ Backend build process completed successfully');
  } catch (error) {
    console.error('❌ An unexpected error occurred during backend build:', error);
    process.exit(1);
  }
}

buildBackend();
