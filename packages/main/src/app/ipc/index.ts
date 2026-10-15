import type { MitmProxyManager } from '../../services/capture/mitm-proxy.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import type { WindowManager } from '../window-manager.js';
import { registerSettingsHandlers } from './settings.js';
import { registerSystemHandlers } from './system.js';
import { registerWindowHandlers } from './windows.js';

/**
 * Registers the whole IPC surface, grouped by the domain each channel belongs to.
 */
export function registerIpcHandlers(
  windowManager: WindowManager,
  engine: EngineService,
  mitmProxyManager: MitmProxyManager,
) {
  registerWindowHandlers(windowManager);
  registerSettingsHandlers(mitmProxyManager);
  registerSystemHandlers(windowManager, engine);
}
