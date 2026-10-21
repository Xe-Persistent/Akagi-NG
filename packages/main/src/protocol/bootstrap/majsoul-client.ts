import { errorMessage } from '../../shared/errors.js';
import { getGameUrl, MAJSOUL_SERVERS } from '../../shared/schema/platforms.js';
import { type BootstrapLogger, silentLogger } from './logger.js';
import { ClassId, SerializedFile } from './serialized-file.js';
import { UnityFsBundle } from './unityfs.js';

/**
 * Downloads the protocol descriptors straight from the live Unity client.
 *
 * Mahjong Soul migrated its client to Unity WebGL; the protocol messages now
 * live in the client's asset bundles, so the (lagging) `res/proto/liqi.json`
 * CDN resource is no longer the source of truth. The chain mirrors the
 * reference extractor:
 *
 *   client HTML -> issuer/productVersion
 *   -> assetbundles/clientBundleSettings -> warehouseSettings -> bundle base
 *   -> texture profile (ASTC, then DXT) -> bundle_hash.txt
 *   -> bundle_info_so.majset (BundleInfoSO: asset path -> bundle name)
 *   -> the bundles owning the wanted assets -> TextAsset payloads
 */
/**
 * The Chinese server serves the same global WebGL build the other clients are
 * derived from, so the extractor always follows it regardless of the server
 * the user plays on.
 */
const CLIENT_URL = getGameUrl(MAJSOUL_SERVERS.CN);
const TEXTURE_PROFILES = ['ASTC', 'DXT'] as const;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface MajsoulClientBuild {
  /** Build channel, e.g. `chs_t` for the global WebGL client. */
  issuer: string;
  /** Unity `productVersion`, e.g. `4.0.47`. */
  productVersion: string;
  /** Scheme and host serving the bundles (the client HTML lives under `/1/`). */
  origin: string;
}

export interface BundleDescriptor {
  name: string;
  fileSize: number;
}

export interface AssetDescriptor {
  assetPath: string;
  ownerBundleIndex: number;
}

export interface BundleInfo {
  bundleInfos: BundleDescriptor[];
  assetInfos: AssetDescriptor[];
}

export interface RemoteTextAsset {
  name: string;
  data: Uint8Array;
}

interface BundleSetting {
  urls: { url: string; weight?: number; Priority?: number }[];
  bundlePath: string;
  warehouseSettingPath?: string;
}

export interface MajsoulAssetClientOptions {
  log?: BootstrapLogger;
  timeoutMs?: number;
}

export class MajsoulAssetClient {
  private readonly log: BootstrapLogger;
  private readonly timeoutMs: number;

  constructor(options: MajsoulAssetClientOptions = {}) {
    this.log = options.log ?? silentLogger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Reads the issuer and product version out of the WebGL client HTML. */
  async fetchBuild(): Promise<MajsoulClientBuild> {
    const html = await this.fetchText(CLIENT_URL);
    const loader = /Build\/([^"']+?\.loader\.js)/.exec(html)?.[1];
    const productVersion = /productVersion\s*:\s*["']([^"']+)["']/.exec(html)?.[1] ?? 'unknown';
    if (!loader || !loader.includes('-WebGL-release-')) {
      throw new Error('Could not locate the Unity WebGL loader in the client HTML');
    }
    const issuer = loader.slice(0, loader.indexOf('-WebGL-release-'));
    const origin = new URL(CLIENT_URL).origin;
    this.log.info(`Client build: issuer=${issuer} productVersion=${productVersion}`);
    return { issuer, productVersion, origin };
  }

  /**
   * Walks `clientBundleSettings` -> `warehouseSettings` -> texture profile and
   * returns the directory the bundles (and `bundle_info_so.majset`) live in.
   */
  async resolveProfile(
    build: MajsoulClientBuild,
  ): Promise<{ profileBase: string; bundleHash: string }> {
    const settingsUrl = `${build.origin}/assetbundles/clientBundleSettings/${build.issuer}-release.json`;
    const settings = (await this.fetchJson(settingsUrl)) as { warehouses?: BundleSetting[] };
    const warehouse = settings.warehouses?.[0];
    if (!warehouse?.warehouseSettingPath) {
      throw new Error(`No usable warehouse in ${settingsUrl}`);
    }

    const warehouseUrl = `${chooseUrl(warehouse.urls)}${warehouse.warehouseSettingPath}`;
    const warehouseSettings = (await this.fetchJson(warehouseUrl)) as BundleSetting;
    const bundleBase =
      `${chooseUrl(warehouseSettings.urls)}${warehouseSettings.bundlePath}`.replace(/\/+$/, '/');

    for (const profile of TEXTURE_PROFILES) {
      const base = `${bundleBase}${profile}/`;
      try {
        const hash = (await this.fetchText(`${base}bundle_hash.txt`)).trim();
        if (hash) {
          this.log.info(`Bundle profile: ${base} (hash ${hash})`);
          return { profileBase: base, bundleHash: hash };
        }
      } catch (error) {
        this.log.debug(`Texture profile ${profile} unavailable: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      `No usable texture profile (${TEXTURE_PROFILES.join('/')}) under ${bundleBase}`,
    );
  }

  /** Reads `BundleInfoSO` — the asset-path to bundle-name map of the client. */
  async fetchBundleInfo(profileBase: string): Promise<BundleInfo> {
    const url = `${profileBase}bundle_info_so.majset`;
    const bundle = UnityFsBundle.open(await this.fetchBytes(url));

    for (const path of bundle.listEntryPaths()) {
      const file = SerializedFile.open(bundle.readEntry(path));
      for (const object of file.objectsOfClass(ClassId.MonoBehaviour)) {
        const tree = file.readTypetree(object) as Record<string, unknown>;
        if (Array.isArray(tree.bundleInfos) && Array.isArray(tree.assetInfos)) {
          const info = {
            bundleInfos: tree.bundleInfos as BundleDescriptor[],
            assetInfos: tree.assetInfos as AssetDescriptor[],
          };
          this.log.info(
            `BundleInfoSO: ${info.bundleInfos.length} bundles, ${info.assetInfos.length} assets`,
          );
          return info;
        }
      }
    }

    throw new Error('BundleInfoSO was not found in bundle_info_so.majset');
  }

  /** Downloads every bundle that owns one of `assetPaths` and extracts its TextAssets. */
  async downloadAssets(
    profileBase: string,
    bundleInfo: BundleInfo,
    assetPaths: string[],
  ): Promise<Map<string, RemoteTextAsset>> {
    const wanted = new Map<number, string[]>();
    for (const assetPath of assetPaths) {
      const asset = bundleInfo.assetInfos.find((candidate) => candidate.assetPath === assetPath);
      if (!asset) {
        this.log.warn(`Asset path ${assetPath} is missing from BundleInfoSO`);
        continue;
      }
      const paths = wanted.get(asset.ownerBundleIndex) ?? [];
      paths.push(assetPath);
      wanted.set(asset.ownerBundleIndex, paths);
    }

    const assets = new Map<string, RemoteTextAsset>();
    for (const [index, paths] of [...wanted.entries()].sort((a, b) => a[0] - b[0])) {
      const descriptor = bundleInfo.bundleInfos[index];
      if (!descriptor) throw new Error(`BundleInfoSO has no bundle at index ${index}`);

      this.log.debug(
        `Downloading ${descriptor.name} (${descriptor.fileSize} bytes) for ${paths.length} asset(s)`,
      );
      const bundle = UnityFsBundle.open(await this.fetchBytes(`${profileBase}${descriptor.name}`));

      for (const entryPath of bundle.listEntryPaths()) {
        const file = SerializedFile.open(bundle.readEntry(entryPath));
        for (const object of file.objectsOfClass(ClassId.TextAsset)) {
          const textAsset = file.readTextAsset(object);
          if (!textAsset.name) continue;
          assets.set(textAsset.name, { name: textAsset.name, data: textAsset.script });
        }
      }
    }

    return assets;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.request(url);
    return response.json();
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.request(url);
    return response.text();
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await this.request(url);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    return response;
  }
}

/** Picks the fastest mirror: highest `Priority`, then highest `weight`. */
function chooseUrl(
  entries: { url: string; weight?: number; Priority?: number }[] | undefined,
): string {
  const sorted = [...(entries ?? [])].sort(
    (a, b) => (b.Priority ?? 0) - (a.Priority ?? 0) || (b.weight ?? 0) - (a.weight ?? 0),
  );
  const [first] = sorted;
  if (!first) throw new Error('Bundle settings contain no mirror URLs');
  return first.url.replace(/\/+$/, '');
}

/**
 * Maps a Unity asset path onto the TextAsset name inside its bundle: try the
 * file name, its `.bytes`-less form and its extension-less form, in that order.
 */
export function findTextAsset(
  assets: Map<string, RemoteTextAsset>,
  assetPath: string,
): RemoteTextAsset | undefined {
  const base = assetPath.split('/').pop() ?? assetPath;
  const candidates = [base];
  if (base.endsWith('.bytes')) candidates.push(base.slice(0, -'.bytes'.length));
  const withoutExtension = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  candidates.push(withoutExtension);

  for (const candidate of candidates) {
    const match = assets.get(candidate) ?? assets.get(`${candidate}.bytes`);
    if (match) return match;
  }
  return undefined;
}
