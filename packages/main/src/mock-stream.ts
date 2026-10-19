import { createLogger } from './logging/index.js';
import { generateMockData } from './mock-data.js';
import { engineStatus } from './services/engine-status.js';
import { broadcastToWindows } from './shared/broadcast.js';

const logger = createLogger('MockStream');

/** How long each canned scenario stays on screen. */
export const MOCK_TICK_MS = 3000;

let timer: NodeJS.Timeout | null = null;
let tick = 0;

/**
 * Plays the canned scenarios into the HUD instead of a captured game, so the
 * recommendations and the status indicators can be inspected with no model and
 * no table. Started by `npm run dev:mock`; nothing else publishes while it runs.
 */
export function startMockStream() {
  if (timer) return;

  logger.info(`Mock stream started (${MOCK_TICK_MS}ms per scenario)`);
  publishFrame();
  timer = setInterval(publishFrame, MOCK_TICK_MS);
}

export function stopMockStream() {
  if (!timer) return;

  clearInterval(timer);
  timer = null;
  logger.info('Mock stream stopped');
}

/** One tick: the status first, so the indicator matches the frame it belongs to. */
function publishFrame() {
  const frame = generateMockData(tick++);

  const { connection, model, modelName, notice } = frame.status;
  engineStatus.set({ connection, model, modelName: modelName ?? null });
  if (notice) engineStatus.notice(notice);

  broadcastToWindows('engine:recommendations', { recommendations: frame.recommendations });
}
