import { createLogger } from '../../logging/index.js';
import type { MajsoulBridge } from '../../protocol/majsoul/bridge.js';
import type { EngineService } from '../engine/engine-service.js';
import { engineStatus } from '../engine-status.js';

const logger = createLogger('Capture');

/** Capture path that saw a frame; only shows up in the log. */
export type CaptureSource = 'CDP' | 'MITM';

/**
 * Parses one captured frame and feeds the resulting events to the engine.
 * Shared by the CDP and MITM paths so the status notices and the failure
 * handling stay identical between them.
 */
export async function ingestCapturedFrame(
  engine: EngineService,
  bridge: MajsoulBridge,
  content: Buffer,
  source: CaptureSource,
): Promise<void> {
  try {
    const output = bridge.parse(content, source);

    if (output.parseFailed) {
      engineStatus.notice('parse_error');
    }
    if (output.replayed) {
      engineStatus.notice('replay');
    }

    if (output.events.length > 0) {
      await engine.ingest(output.events, output.replayed === true);
    }
  } catch (error) {
    logger.error(`Failed to process a ${source} frame:`, error);
  }
}
