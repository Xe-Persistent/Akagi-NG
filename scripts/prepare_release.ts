import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '../');
const extraDir = join(rootDir, 'build', 'extra');

// 0. Ensure extraDir exists
if (existsSync(extraDir)) {
  rmSync(extraDir, { recursive: true, force: true });
}
mkdirSync(extraDir, { recursive: true });

console.log('📦 Preparing release assets...');

// 1. Create target folders
['models', 'logs', 'config'].forEach((folder) => {
  const folderPath = join(extraDir, folder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath);
  }
});

// 2. Bundle Models
['akagi4p.safetensors', 'akagi3p.safetensors'].forEach((modelFile) => {
  const src = join(rootDir, 'models', modelFile);
  if (existsSync(src)) {
    copyFileSync(src, join(extraDir, 'models', modelFile));
    console.log(`   ✅ Bundled model: ${modelFile}`);
  } else {
    console.warn(`   ⚠️ Model missing, skipped: ${modelFile}`);
  }
});

// 3. Config/Logs placeholders
['logs', 'config'].forEach((folder) => {
  writeFileSync(join(extraDir, folder, '_placeholder'), '');
});

console.log('✅ Release assets prepared in build/extra');
