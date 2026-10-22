import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** The parts of a workspace `package.json` this script reads or rewrites. */
interface Manifest {
  version?: string;
  _comment?: unknown;
  [key: string]: unknown;
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
}

function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Syncs the version from root package.json down to the Electron, frontend and
 * Rust engine packages. Lockfiles are intentionally left alone: they are updated
 * by their own package managers when dependencies change.
 */
function syncVersion() {
  try {
    const projectRoot = resolve(__dirname, '..');
    const rootPackageJsonPath = join(projectRoot, 'package.json');

    console.log(`Reading master version from: ${rootPackageJsonPath}`);

    if (!existsSync(rootPackageJsonPath)) {
      throw new Error(`Master package.json not found at ${rootPackageJsonPath}`);
    }

    const rootPackageJson = readManifest(rootPackageJsonPath);
    const version = rootPackageJson.version;

    if (!version) {
      throw new Error('Version missing in root package.json');
    }

    console.log(`Master version declared as: ${version}`);

    const electronPackageJsonPath = join(projectRoot, 'packages', 'main', 'package.json');
    console.log(`Updating ${electronPackageJsonPath}...`);
    const electronPackageJson = readManifest(electronPackageJsonPath);
    electronPackageJson.version = version;
    writeManifest(electronPackageJsonPath, electronPackageJson);
    console.log(`✅ Synced to packages/main/package.json`);

    const frontendPackageJsonPath = join(projectRoot, 'packages', 'frontend', 'package.json');
    console.log(`Updating ${frontendPackageJsonPath}...`);
    const frontendPackageJson = readManifest(frontendPackageJsonPath);
    frontendPackageJson.version = version;
    if (frontendPackageJson._comment) {
      delete frontendPackageJson._comment;
    }
    writeManifest(frontendPackageJsonPath, frontendPackageJson);
    console.log(`✅ Synced to packages/frontend/package.json`);

    const rustEnginePackageJsonPath = join(projectRoot, 'packages', 'rust_engine', 'package.json');
    console.log(`Updating ${rustEnginePackageJsonPath}...`);
    const rustEnginePackageJson = readManifest(rustEnginePackageJsonPath);
    rustEnginePackageJson.version = version;
    writeManifest(rustEnginePackageJsonPath, rustEnginePackageJson);
    console.log(`✅ Synced to packages/rust_engine/package.json`);

    const rustEngineCargoTomlPath = join(projectRoot, 'packages', 'rust_engine', 'Cargo.toml');
    console.log(`Updating ${rustEngineCargoTomlPath}...`);
    const cargoToml = readFileSync(rustEngineCargoTomlPath, 'utf-8');
    const cargoVersion = /(\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m;
    if (!cargoVersion.test(cargoToml)) {
      throw new Error(`Could not find the [package] version in ${rustEngineCargoTomlPath}`);
    }
    writeFileSync(rustEngineCargoTomlPath, cargoToml.replace(cargoVersion, `$1${version}$2`));
    console.log(`✅ Synced to packages/rust_engine/Cargo.toml`);

    console.log(`🎉 Monorepo version successfully synced!`);
  } catch (error) {
    console.error('❌ Failed to sync versions:', error);
    process.exit(1);
  }
}

syncVersion();
