import {
  buildDescriptor,
  type DescriptorBuild,
  type DescriptorStats,
  detectRegression,
  diffDescriptors,
  type LiqiDescriptorJson,
  type ProtoConfig,
  validateDescriptor,
} from './descriptor.js';
import { type BootstrapLogger, silentLogger } from './logger.js';
import { decodeLuaPayload, parseLuaModule, type ProtoModule, resolveTypes } from './lua-protos.js';
import { findTextAsset, MajsoulAssetClient } from './majsoul-client.js';

/**
 * Orchestrates the protocol bootstrap: read the descriptors out of the live
 * Unity client and compile them into the descriptor JSON the bridge consumes.
 */
export const PROTOL_ASSET_PREFIX = 'LuaByte/Lua/Protol/';
export const PROTO_CONFIG_ASSET = 'MyAssets/docs/proto_config.bytes';
const LUA_ASSET_SUFFIX = '.lua.bytes';

export interface ProtocolSources {
  /** Module name (`liqi_struct_pb`) to Lua source. */
  luaSources: Map<string, string>;
  protoConfig: ProtoConfig;
  issuer: string;
  productVersion: string;
  bundleHash: string;
}

export interface BootstrapMeta {
  issuer: string;
  productVersion: string;
  bundleHash: string;
  modules: number;
  messages: number;
  enums: number;
  methods: number;
  /** ISO timestamp of the extraction that produced the descriptor. */
  extractedAt: string;
}

export interface BootstrapResult {
  descriptor: LiqiDescriptorJson;
  meta: BootstrapMeta;
  stats: DescriptorStats;
  /** Human-readable summary of the difference against the previous descriptor. */
  diff: string[];
  /** Non-fatal problems, e.g. an extraction that lost most of the old schema. */
  warnings: string[];
}

export interface BootstrapOptions {
  log?: BootstrapLogger;
  timeoutMs?: number;
  /** Previously shipped descriptor, used for the change summary. */
  previousDescriptor?: LiqiDescriptorJson | null;
}

/** Assets carrying the wire protocol descriptors. */
export function collectProtocolAssetPaths(assetPaths: string[]): string[] {
  return assetPaths.filter(
    (assetPath) =>
      (assetPath.startsWith(PROTOL_ASSET_PREFIX) && assetPath.endsWith(LUA_ASSET_SUFFIX)) ||
      assetPath === PROTO_CONFIG_ASSET,
  );
}

/** Downloads the Lua descriptor scripts and `proto_config.bytes` from the client. */
export async function fetchProtocolSources(
  options: BootstrapOptions = {},
): Promise<ProtocolSources> {
  const log = options.log ?? silentLogger;
  const client = new MajsoulAssetClient({ log, timeoutMs: options.timeoutMs });

  const build = await client.fetchBuild();
  const profile = await client.resolveProfile(build);
  const bundleInfo = await client.fetchBundleInfo(profile.profileBase);

  const wanted = collectProtocolAssetPaths(bundleInfo.assetInfos.map((asset) => asset.assetPath));
  if (wanted.length === 0) {
    throw new Error('The client reports no protocol assets (LuaByte/Lua/Protol)');
  }

  const assets = await client.downloadAssets(profile.profileBase, bundleInfo, wanted);

  const luaSources = new Map<string, string>();
  let protoConfig: ProtoConfig | null = null;

  for (const assetPath of wanted) {
    const asset = findTextAsset(assets, assetPath);
    if (!asset) {
      log.warn(`TextAsset for ${assetPath} was not found in its bundle`);
      continue;
    }

    if (assetPath === PROTO_CONFIG_ASSET) {
      protoConfig = JSON.parse(Buffer.from(asset.data).toString('utf8')) as ProtoConfig;
      continue;
    }

    const fileName = assetPath.split('/').pop() ?? assetPath;
    const moduleName = fileName.slice(0, -LUA_ASSET_SUFFIX.length);
    const source = Buffer.from(decodeLuaPayload(asset.data)).toString('utf8');
    luaSources.set(moduleName, source);
  }

  if (luaSources.size === 0) throw new Error('No protocol Lua descriptor was found in the client');
  if (!protoConfig) throw new Error('proto_config.bytes was not found in the client');

  log.info(`Extracted ${luaSources.size} protocol module(s) from ${build.productVersion}`);
  return {
    luaSources,
    protoConfig,
    issuer: build.issuer,
    productVersion: build.productVersion,
    bundleHash: profile.bundleHash,
  };
}

/** Pure step: Lua sources + service table -> descriptor JSON (validated). */
export function compileProtocolDescriptor(sources: ProtocolSources): DescriptorBuild {
  const modules = new Map<string, ProtoModule>();
  for (const [name, source] of sources.luaSources) {
    modules.set(name, parseLuaModule(name, source));
  }
  resolveTypes(modules);

  const build = buildDescriptor(modules, sources.protoConfig);
  validateDescriptor(build.descriptor);
  return build;
}

/** Full pipeline, ready to be persisted by the caller (CLI or main process). */
export async function bootstrapMajsoulProtocol(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const sources = await fetchProtocolSources(options);
  const { descriptor, stats } = compileProtocolDescriptor(sources);

  const warnings: string[] = [];
  const regression = detectRegression(options.previousDescriptor ?? null, descriptor);
  if (regression) warnings.push(regression);

  return {
    descriptor,
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
    stats,
    diff: diffDescriptors(options.previousDescriptor ?? null, descriptor),
    warnings,
  };
}
