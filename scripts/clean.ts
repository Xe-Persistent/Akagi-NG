import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '../');
const distDir = join(rootDir, 'dist');
const buildDir = join(rootDir, 'build');

const removeDir = (dirPath: string) => {
  if (existsSync(dirPath)) {
    console.log(`Cleaning ${dirPath}...`);
    try {
      rmSync(dirPath, { recursive: true, force: true });
      console.log(`Successfully removed ${dirPath}`);
    } catch (error) {
      console.error(`Error removing ${dirPath}:`, error);
    }
  } else {
    console.log(`${dirPath} does not exist, skipping.`);
  }
};

removeDir(distDir);
removeDir(buildDir);

console.log('Clean complete.');
