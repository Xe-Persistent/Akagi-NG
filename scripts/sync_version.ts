import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Syncs the version from root package.json down to electron, frontend, and backend environments.
 */
function syncVersion() {
  try {
    const projectRoot = resolve(__dirname, '..');
    const rootPackageJsonPath = join(projectRoot, 'package.json');

    console.log(`Reading master version from: ${rootPackageJsonPath}`);

    if (!existsSync(rootPackageJsonPath)) {
      throw new Error(`Master package.json not found at ${rootPackageJsonPath}`);
    }

    const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf-8'));
    const version = rootPackageJson.version;

    if (!version) {
      throw new Error('Version missing in root package.json');
    }

    console.log(`Master version declared as: ${version}`);

    // Update electron/package.json
    const electronPackageJsonPath = join(projectRoot, 'packages', 'main', 'package.json');
    console.log(`Updating ${electronPackageJsonPath}...`);
    const electronPackageJson = JSON.parse(readFileSync(electronPackageJsonPath, 'utf-8'));
    electronPackageJson.version = version;
    writeFileSync(electronPackageJsonPath, JSON.stringify(electronPackageJson, null, 2) + '\n');
    console.log(`✅ Synced to packages/main/package.json`);

    // Update frontend/package.json
    const frontendPackageJsonPath = join(projectRoot, 'packages', 'frontend', 'package.json');
    console.log(`Updating ${frontendPackageJsonPath}...`);
    const frontendPackageJson = JSON.parse(readFileSync(frontendPackageJsonPath, 'utf-8'));
    frontendPackageJson.version = version;
    if (frontendPackageJson._comment) {
      delete frontendPackageJson._comment;
    }
    writeFileSync(frontendPackageJsonPath, JSON.stringify(frontendPackageJson, null, 2) + '\n');
    console.log(`✅ Synced to packages/frontend/package.json`);

    console.log(`🎉 Monorepo version successfully synced!`);
  } catch (error) {
    console.error('❌ Failed to sync versions:', error);
    process.exit(1);
  }
}

syncVersion();
