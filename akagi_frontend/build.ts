import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

try {
  // 1. Get version from Python package
  // We use python command to print the version.
  // This assumes 'akagi-ng' is installed in the environment, OR we parse pyproject.toml directly.
  // Parsing pyproject.toml is safer as it doesn't require the package to be installed.

  const pyprojectPath = path.join(process.cwd(), '..', 'akagi_backend', 'pyproject.toml');
  const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
  const versionMatch = pyprojectContent.match(/^\s*version\s*=\s*["']([^"']+)["']/m);

  let version = 'dev';
  if (versionMatch && versionMatch[1]) {
    version = versionMatch[1];
  } else {
    console.warn('Could not find version in pyproject.toml, falling back to "dev"');
  }

  console.log(`Detected Akagi-NG version: ${version}`);

  // 2. Set environment variable and run build
  // We use cross-platform way by passing it to the command or using child_process env

  console.log('Running: tsc && vite build');
  execSync('tsc && vite build', {
    stdio: 'inherit',
    env: { ...process.env, AKAGI_VERSION: version },
  });
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
