import fs from 'fs';
import os from 'os';
import path from 'path';

const rootDir = path.resolve(__dirname, '../../');
const extraDir = path.join(rootDir, 'build', 'extra');

if (fs.existsSync(extraDir)) {
  fs.rmSync(extraDir, { recursive: true, force: true });
}
fs.mkdirSync(extraDir, { recursive: true });

console.log('Preparing release assets...');

const copyIfExists = (src: string, dest: string, label: string) => {
  if (!fs.existsSync(src)) {
    console.warn(`   Warning: Missing ${label}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`   Bundled ${label}`);
};

const licenseSource = path.join(rootDir, 'LICENSE');
copyIfExists(licenseSource, path.join(extraDir, 'LICENSE.txt'), 'LICENSE.txt');

['lib', 'models', 'logs', 'config'].forEach((folder) => {
  fs.mkdirSync(path.join(extraDir, folder), { recursive: true });
});

['mortal.pth', 'mortal3p.pth', 'LICENSE'].forEach((modelFile) => {
  copyIfExists(
    path.join(rootDir, 'models', modelFile),
    path.join(extraDir, 'models', modelFile),
    `model ${modelFile}`,
  );
});

const platform = os.platform();
const sysStr =
  platform === 'win32'
    ? 'pc-windows-msvc'
    : platform === 'darwin'
      ? 'apple-darwin'
      : 'unknown-linux-gnu';
const ext = platform === 'win32' ? 'pyd' : 'so';
const archStr = platform === 'darwin' ? 'aarch64' : 'x86_64';

['libriichi', 'libriichi3p'].forEach((prefix) => {
  const pattern = `${prefix}-3.12-${archStr}-${sysStr}.${ext}`;
  const versionedSrc = path.join(rootDir, 'lib', pattern);
  const fallbackSrc = path.join(rootDir, 'lib', `${prefix}.${ext}`);
  const dest = path.join(extraDir, 'lib', `${prefix}.${ext}`);

  if (fs.existsSync(versionedSrc)) {
    copyIfExists(versionedSrc, dest, `lib ${prefix}.${ext} (from ${pattern})`);
    return;
  }
  copyIfExists(fallbackSrc, dest, `lib ${prefix}.${ext}`);
});

copyIfExists(path.join(rootDir, 'lib', 'LICENSE'), path.join(extraDir, 'lib', 'LICENSE'), 'lib LICENSE');

['logs', 'config'].forEach((folder) => {
  fs.writeFileSync(path.join(extraDir, folder, '_placeholder'), '');
});

copyIfExists(
  path.join(rootDir, 'config', 'majsoul_mod', 'lqc.lqbin'),
  path.join(extraDir, 'config', 'majsoul_mod', 'lqc.lqbin'),
  'Majsoul mod catalog lqc.lqbin',
);

console.log('Release assets prepared in build/extra');
