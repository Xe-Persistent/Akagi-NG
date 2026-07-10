import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { platform as getPlatform } from 'node:os';
import { join, resolve } from 'node:path';

const rootDir = resolve(__dirname, '../');
const extraDir = join(rootDir, 'build', 'extra');
const silentRelease = process.env.AKAGI_NO_LOGS === '1';

// 0. Ensure extraDir exists
if (existsSync(extraDir)) {
  rmSync(extraDir, { recursive: true, force: true });
}
mkdirSync(extraDir, { recursive: true });

console.log('📦 Preparing release assets...');

// 1. Create target folders
['lib', 'models', 'logs', 'config'].forEach((folder) => {
  const folderPath = join(extraDir, folder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath);
  }
});

// 2. Bundle Models
['mortal.pth', 'mortal3p.pth', 'LICENSE'].forEach((modelFile) => {
  const src = join(rootDir, 'models', modelFile);
  if (existsSync(src)) {
    copyFileSync(src, join(extraDir, 'models', modelFile));
    console.log(`   ✅ Bundled model: ${modelFile}`);
  }
});

// 3. Bundle and rename libriichi for current platform
const platform = getPlatform();

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
  const srcFile = join(rootDir, 'lib', pattern);
  if (existsSync(srcFile)) {
    copyFileSync(srcFile, join(extraDir, 'lib', `${prefix}.${ext}`));
    console.log(`   ✅ Bundled lib: ${prefix}.${ext} (from ${pattern})`);
  } else {
    // try fallback
    const fallbackSrc = join(rootDir, 'lib', `${prefix}.${ext}`);
    if (existsSync(fallbackSrc)) {
      copyFileSync(fallbackSrc, join(extraDir, 'lib', `${prefix}.${ext}`));
      console.log(`   ✅ Bundled lib: ${prefix}.${ext} (from fallback exact match)`);
    } else {
      console.warn(`   ⚠️ Warning: Could not find lib file ${pattern}`);
    }
  }
});

// 4. Copy lib/LICENSE
const libLicense = join(rootDir, 'lib', 'LICENSE');
if (existsSync(libLicense)) {
  copyFileSync(libLicense, join(extraDir, 'lib', 'LICENSE'));
  console.log('   ✅ Bundled lib: LICENSE');
}

// 5. Config/Logs placeholders
['logs', 'config'].forEach((folder) => {
  writeFileSync(join(extraDir, folder, '_placeholder'), '');
});

if (silentRelease) {
  const settings = {
    log_level: 'OFF',
    locale: 'en-US',
    game_url: 'https://game.maj-soul.com/1/',
    majsoul_server: 'cn',
    platform: 'majsoul',
    mitm: { enabled: false, host: '127.0.0.1', port: 6789, upstream: '' },
    server: { host: '127.0.0.1', port: 8765 },
    ot: { online: false, server: '', api_key: '' },
    api: {
      enabled: false,
      base_url: 'https://mjapi.shinkuan.me',
      key: '',
      model_4p: '',
      model_3p: '',
    },
    model_config: { model_4p: 'mortal.pth', model_3p: 'mortal3p.pth', temperature: 0.3 },
  };
  writeFileSync(join(extraDir, '.no-logs'), 'Akagi-NG silent release\n');
  writeFileSync(
    join(extraDir, 'config', 'settings.json'),
    JSON.stringify(settings, null, 2) + '\n',
  );
  console.log('   ✅ Disabled Electron, Chromium, and backend file logging for this release');
}

console.log('✅ Release assets prepared in build/extra');
