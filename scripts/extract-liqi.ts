/**
 * Extracts the Mahjong Soul wire protocol from the live Unity client and writes
 * `assets/liqi.json` (protobuf.js descriptor) plus `assets/liqi.meta.json`.
 *
 * Usage:
 *   tsx scripts/extract-liqi.ts [--check] [--from-raw DIR] [--timeout MS]
 *
 * Offline mode (`--from-raw`) reads `Protol/*.lua` and `proto_config.bytes` from
 * a directory instead of downloading the Unity bundles; it exercises the same
 * pure parsing/rendering path and is what the CI check uses for validation.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapMajsoulProtocol,
  type BootstrapResult,
  compileProtocolDescriptor,
  consoleLogger,
  detectRegression,
  diffDescriptors,
  type LiqiDescriptorJson,
  type ProtocolSources,
  type ProtoConfig,
} from '../packages/main/src/protocol/bootstrap/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DESCRIPTOR_PATH = join(ROOT_DIR, 'assets', 'liqi.json');
const META_PATH = join(ROOT_DIR, 'assets', 'liqi.meta.json');

interface Options {
  check: boolean;
  fromRaw?: string;
  timeoutMs?: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--from-raw') options.fromRaw = argv[++i];
    else if (arg === '--timeout') options.timeoutMs = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--help') {
      console.log('Usage: extract-liqi [--check] [--from-raw DIR] [--timeout MS]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Loads `Protol/*.lua` + `proto_config.bytes` from a directory. */
function loadSourcesFromRaw(rawDir: string): ProtocolSources {
  const dir = resolve(rawDir);
  const protolDir = join(dir, 'Protol');
  if (!existsSync(protolDir)) throw new Error(`Offline mode needs ${protolDir}`);

  const luaSources = new Map<string, string>();
  for (const file of readdirSync(protolDir)) {
    if (!file.endsWith('.lua')) continue;
    luaSources.set(file.slice(0, -'.lua'.length), readFileSync(join(protolDir, file), 'utf8'));
  }
  if (luaSources.size === 0) throw new Error(`No *.lua descriptors in ${protolDir}`);

  const configCandidates = [
    join(dir, 'proto_config.bytes'),
    join(dir, 'proto_config.json'),
    join(dir, 'docs', 'proto_config.bytes'),
  ];
  const configPath = configCandidates.find((candidate) => existsSync(candidate));
  if (!configPath) throw new Error(`proto_config.bytes not found in ${dir}`);

  consoleLogger.info(`[offline] ${luaSources.size} module(s) from ${protolDir}`);
  return {
    luaSources,
    protoConfig: JSON.parse(readFileSync(configPath, 'utf8')) as ProtoConfig,
    issuer: 'offline',
    productVersion: 'offline',
    bundleHash: '',
  };
}

function warningsFor(previous: LiqiDescriptorJson | null, next: LiqiDescriptorJson): string[] {
  const regression = detectRegression(previous, next);
  return regression ? [regression] : [];
}

function readPreviousDescriptor(): LiqiDescriptorJson | null {
  if (!existsSync(DESCRIPTOR_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DESCRIPTOR_PATH, 'utf8')) as LiqiDescriptorJson;
  } catch (error) {
    consoleLogger.warn(`Ignoring unreadable ${DESCRIPTOR_PATH}: ${String(error)}`);
    return null;
  }
}

function writeIfChanged(path: string, content: string): boolean {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (previous === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  consoleLogger.info(`wrote ${path} (${content.length} bytes)`);
  return true;
}

function emitGitHubOutput(name: string, value: string): void {
  const outputFile = process.env['GITHUB_OUTPUT'];
  if (outputFile) appendFileSync(outputFile, `${name}=${value}\n`);
  else consoleLogger.info(`[output] ${name}=${value}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const previous = readPreviousDescriptor();

  let result: BootstrapResult;
  if (options.fromRaw) {
    const sources = loadSourcesFromRaw(options.fromRaw);
    const { descriptor, stats } = compileProtocolDescriptor(sources);
    result = {
      descriptor,
      stats,
      meta: {
        issuer: sources.issuer,
        productVersion: sources.productVersion,
        bundleHash: sources.bundleHash,
        modules: sources.luaSources.size,
        messages: stats.messages,
        enums: stats.enums,
        methods: stats.methods,
        extractedAt: new Date().toISOString(),
      },
      diff: diffDescriptors(previous, descriptor),
      warnings: warningsFor(previous, descriptor),
    };
  } else {
    result = await bootstrapMajsoulProtocol({
      log: consoleLogger,
      previousDescriptor: previous,
      timeoutMs: options.timeoutMs,
    });
  }

  const { meta, stats, diff } = result;
  consoleLogger.info(
    `[extract] ${meta.modules} module(s), ${stats.messages} message(s), ${stats.enums} enum(s), ` +
      `${stats.services} service(s), ${stats.methods} rpc route(s)`,
  );
  if (stats.skippedMethods.length > 0) {
    consoleLogger.info(
      `[extract] skipped ${stats.skippedMethods.length} debug/test RPC(s) with stripped types: ` +
        stats.skippedMethods.join(', '),
    );
  }
  if (stats.unresolvedFields.length > 0) {
    consoleLogger.warn(
      `[extract] ${stats.unresolvedFields.length} field(s) were emitted as bytes: ` +
        stats.unresolvedFields.slice(0, 10).join(', '),
    );
  }
  for (const line of diff) consoleLogger.info(`[diff] ${line}`);
  for (const warning of result.warnings) consoleLogger.warn(`[warn] ${warning}`);

  const descriptorText = `${JSON.stringify(result.descriptor, null, 2)}\n`;
  const metaText = `${JSON.stringify(meta, null, 2)}\n`;

  if (options.check) {
    const changed =
      !existsSync(DESCRIPTOR_PATH) || readFileSync(DESCRIPTOR_PATH, 'utf8') !== descriptorText;
    emitGitHubOutput('changed', changed ? 'true' : 'false');
    emitGitHubOutput('product_version', meta.productVersion);
    emitGitHubOutput('bundle_hash', meta.bundleHash);
    if (changed) {
      consoleLogger.error(`[check] ${DESCRIPTOR_PATH} is out of date`);
      process.exit(1);
    }
    consoleLogger.info('[check] protocol descriptor is up to date');
    return;
  }

  const descriptorChanged = writeIfChanged(DESCRIPTOR_PATH, descriptorText);
  const metaChanged = writeIfChanged(META_PATH, metaText);
  emitGitHubOutput('changed', descriptorChanged ? 'true' : 'false');
  emitGitHubOutput('product_version', meta.productVersion);
  emitGitHubOutput('bundle_hash', meta.bundleHash);
  if (!descriptorChanged) consoleLogger.info('[extract] protocol descriptor is unchanged');
  if (!descriptorChanged && metaChanged) {
    consoleLogger.info('[extract] only the metadata file changed');
  }
}

await main();
