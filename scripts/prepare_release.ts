import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '../');
const extraDir = join(rootDir, 'build', 'extra');

// Rebuild `build/extra` from scratch, so a stale asset cannot ship.
if (existsSync(extraDir)) {
  rmSync(extraDir, { recursive: true, force: true });
}
mkdirSync(extraDir, { recursive: true });

console.log('📦 Preparing release assets...');

['models', 'logs', 'config'].forEach((folder) => {
  const folderPath = join(extraDir, folder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath);
  }
});

['akagi4p.safetensors', 'akagi3p.safetensors'].forEach((modelFile) => {
  const src = join(rootDir, 'models', modelFile);
  if (existsSync(src)) {
    copyFileSync(src, join(extraDir, 'models', modelFile));
    console.log(`   ✅ Bundled model: ${modelFile}`);
  } else {
    throw new Error(`Model missing: ${src}`);
  }
});

const modelLicense = join(rootDir, 'models', 'LICENSE');
if (!existsSync(modelLicense)) {
  throw new Error(`Model license missing: ${modelLicense}`);
}
copyFileSync(modelLicense, join(extraDir, 'models', 'LICENSE'));
console.log('   ✅ Bundled model license');

// Git cannot carry an empty directory into a release, hence the placeholders.
['logs', 'config'].forEach((folder) => {
  writeFileSync(join(extraDir, folder, '_placeholder'), '');
});

console.log('✅ Release assets prepared in build/extra');
