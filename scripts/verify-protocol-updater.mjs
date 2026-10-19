/**
 * Runtime verification for the only path that cannot be covered by a test: the
 * protocol updater downloads a live client build and rewrites `assets/liqi.json`.
 * Run it by hand after touching the bootstrap; it needs network.
 *
 *   node --import tsx --import ./scripts/electron-register.mjs scripts/verify-protocol-updater.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const descriptorPath = join(ROOT, 'assets', 'liqi.json');
const metaPath = join(ROOT, 'assets', 'liqi.meta.json');

const before = createHash('sha256').update(readFileSync(descriptorPath)).digest('hex');

const { updateMajsoulProtocol } = await import('../dist/main/services/protocol-updater.js');
const { bridgeManager } = await import('../dist/main/protocol/bridge-manager.js');

let reloaded = 0;
const originalReload = bridgeManager.hotReloadLiqi.bind(bridgeManager);
bridgeManager.hotReloadLiqi = () => {
  reloaded++;
  return originalReload();
};

const started = Date.now();
const result = await updateMajsoulProtocol();
const elapsed = Date.now() - started;

const descriptorText = readFileSync(descriptorPath, 'utf8');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const after = createHash('sha256').update(descriptorText).digest('hex');

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

check('returns a bootstrap result', Boolean(result?.descriptor?.nested?.lq?.nested));
check('reloads the bridge exactly once', reloaded === 1, `reloaded=${reloaded}`);
check('writes the descriptor file', descriptorText.length > 100000, `${descriptorText.length}B`);
check(
  'descriptor exposes the full protocol',
  (() => {
    try {
      const parsed = JSON.parse(descriptorText);
      return Object.keys(parsed.nested.lq.nested).length > 1000;
    } catch {
      return false;
    }
  })(),
);
check(
  'meta records the client version',
  typeof meta.productVersion === 'string',
  meta.productVersion,
);
check(
  'meta matches the returned result',
  meta.messages === result.meta.messages && meta.methods === result.meta.methods,
  `${meta.messages} messages / ${meta.methods} rpcs`,
);
check(
  'counts match the reference extractor',
  result.stats.messages === 1123 &&
    result.stats.methods === 443 &&
    result.stats.skippedMethods.length === 23,
  `messages=${result.stats.messages} methods=${result.stats.methods} skipped=${result.stats.skippedMethods.length}`,
);
check('completes in a sane time', elapsed < 120000, `${elapsed}ms`);
check('descriptor hash unchanged (same client build)', before === after, `${before.slice(0, 12)}`);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(
    `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` - ${item.detail}` : ''}`,
  );
}
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
