import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '../../');
const extraDir = path.join(rootDir, 'build', 'extra');

// Ensure extraDir exists
if (fs.existsSync(extraDir)) {
  fs.rmSync(extraDir, { recursive: true, force: true });
}
fs.mkdirSync(extraDir, { recursive: true });

console.log('📦 Preparing release assets...');

// 1. LICENSE.txt

const licenseSource = path.join(rootDir, 'LICENSE');
if (fs.existsSync(licenseSource)) {
  fs.copyFileSync(licenseSource, path.join(extraDir, 'LICENSE.txt'));
  console.log('   ✅ LICENSE.txt created');
}

// 2. Empty folders
['lib', 'models', 'logs', 'config'].forEach((folder) => {
  const folderPath = path.join(extraDir, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
    // Create _placeholder to ensure folder is preserved in build
    fs.writeFileSync(path.join(folderPath, '_placeholder'), '');
    console.log(`   ✅ Empty folder created with placeholder: ${folder}/`);
  }
});

console.log('✅ Release assets prepared in build/extra');
