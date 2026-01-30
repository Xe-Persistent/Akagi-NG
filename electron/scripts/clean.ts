import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '../../');
const distDir = path.join(rootDir, 'dist');
const buildDir = path.join(rootDir, 'build');

const removeDir = (dirPath: string) => {
  if (fs.existsSync(dirPath)) {
    console.log(`Cleaning ${dirPath}...`);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
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
