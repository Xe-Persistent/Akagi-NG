import { isMajsoulUrl } from '../shared/schema/platforms.js';
import { MajsoulBridge } from './majsoul/bridge.js';

export class BridgeManager {
  private bridge: MajsoulBridge | null = null;

  /**
   * Returns the bridge for a game URL, creating it on first use.
   * Non-majsoul URLs return null and leave the current bridge untouched.
   */
  public getBridgeForUrl(url: string): MajsoulBridge | null {
    if (!isMajsoulUrl(url)) {
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
