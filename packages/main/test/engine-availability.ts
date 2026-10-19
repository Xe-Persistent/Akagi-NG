import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/');

/** The native addon is built per platform and is not part of a fresh checkout. */
const hasAddon = (() => {
  try {
    return readdirSync(`${repoRoot}/packages/rust_engine/native`).some((file) =>
      file.endsWith('.node'),
    );
  } catch {
    return false;
  }
})();

/**
 * The weights live in `models/`; a partial checkout can have the addon but
 * only one of the two model files.
 */
export function hasEngineFor(is3p: boolean): boolean {
  return hasAddon && existsSync(`${repoRoot}/models/${is3p ? 'akagi3p' : 'akagi4p'}.safetensors`);
}

/**
 * The four-player engine and its weights are not part of a fresh checkout, so
 * every test that needs them is skipped rather than failed on a clone with none.
 */
export const hasEngine = hasEngineFor(false);
