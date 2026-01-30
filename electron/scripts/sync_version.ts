import * as fs from 'fs';
import * as path from 'path';

/**
 * Syncs the version from akagi_backend/pyproject.toml to electron/package.json
 */
function syncVersion() {
  try {
    const electronDir = path.resolve(__dirname, '..');
    const projectRoot = path.resolve(electronDir, '..');
    const pyprojectPath = path.join(projectRoot, 'akagi_backend', 'pyproject.toml');
    const packageJsonPath = path.join(electronDir, 'package.json');

    console.log(`Reading version from: ${pyprojectPath}`);

    if (!fs.existsSync(pyprojectPath)) {
      throw new Error(`pyproject.toml not found at ${pyprojectPath}`);
    }

    const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
    const versionMatch = pyprojectContent.match(/^\s*version\s*=\s*["']([^"']+)["']/m);

    if (!versionMatch || !versionMatch[1]) {
      throw new Error('Could not find version in pyproject.toml');
    }

    const version = versionMatch[1];
    console.log(`Detected version: ${version}`);

    console.log(`Updating ${packageJsonPath}...`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    if (packageJson.version === version) {
      console.log('Version is already up to date.');
      return;
    }

    const oldVersion = packageJson.version;
    packageJson.version = version;

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(`✅ Updated package.json version from ${oldVersion} to ${version}`);
  } catch (error) {
    console.error('❌ Failed to sync version:', error);
    process.exit(1);
  }
}

syncVersion();
