import { MajsoulBridge } from './majsoul/majsoul-bridge.js';

const MAJSOUL_URL_MARKERS = ['majsoul', 'maj-soul', 'mahjongsoul'];

export class BridgeManager {
  private bridge: MajsoulBridge | null = null;

  public isMajsoulUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return MAJSOUL_URL_MARKERS.some((marker) => lower.includes(marker));
  }

  /**
   * Returns the bridge for a game URL, creating it on first use.
   * Non-majsoul URLs return null and leave the current bridge untouched.
   */
  public getBridgeForUrl(url: string): MajsoulBridge | null {
    if (!this.isMajsoulUrl(url)) {
      return null;
    }

    this.bridge ??= new MajsoulBridge();
    return this.bridge;
  }

  /**
   * Returns the bridge currently handling game traffic, if any.
   * Used when parsing raw frames that carry no URL of their own.
   */
  public getCurrentBridge(): MajsoulBridge | null {
    return this.bridge;
  }

  public hotReloadLiqi() {
    this.bridge?.liqiProto.reloadLiqi();
  }
}

export const bridgeManager = new BridgeManager();
