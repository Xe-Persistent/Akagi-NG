import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AkagiEngine } from '@akagi-ng/rust-engine';

import { createLogger } from '../../logging/index.js';
import { getProjectRoot } from '../../shared/paths.js';
import type { MJAIEvent } from '../../shared/schema/mjai.js';
import { getSettingsManager } from '../settings-manager.js';
import type { EngineDecision } from './recommendation-mapper.js';

const logger = createLogger('ModelRunner');

export type LoadOutcome =
  | { status: 'loaded'; modelName: string }
  | { status: 'missing'; modelPath: string }
  | { status: 'failed'; error: unknown };

/**
 * Owns the native inference engine: which model file backs it, feeding mjai
 * events into it and asking it for a decision. Failures are reported to the
 * caller so that the service around it decides how the HUD learns about them.
 */
export class ModelRunner {
  private engine: AkagiEngine | null = null;

  public get loaded(): boolean {
    return this.engine !== null;
  }

  public async load(seat: number, is3p: boolean): Promise<LoadOutcome> {
    this.reset();

    const settings = getSettingsManager().getSettings();
    const modelName = is3p ? settings.model_config.model_3p : settings.model_config.model_4p;
    const modelPath = join(getProjectRoot(), 'models', modelName);

    if (!existsSync(modelPath)) {
      return { status: 'missing', modelPath };
    }

    try {
      const modelBytes = readFileSync(modelPath);
      // The native binding is imported lazily so a missing or unbuilt engine
      // only disables inference instead of crashing the whole application.
      const { AkagiEngine } = await import('@akagi-ng/rust-engine');
      this.engine = new AkagiEngine(modelBytes, is3p ? 3 : 4, seat);
      return { status: 'loaded', modelName };
    } catch (error) {
      return { status: 'failed', error };
    }
  }

  /**
   * Feeds one mjai event. Events the engine has no use for are ignored here;
   * a broken engine throws so the caller can surface it.
   */
  public feed(ev: MJAIEvent): void {
    if (!this.engine) return;

    const accepted = this.engine.feedLine(JSON.stringify(ev));
    if (!accepted) {
      logger.verbose(`Engine ignored event: ${ev.type}`);
    }
  }

  /** The current decision, or null when there is nothing to decide. */
  public decide(): EngineDecision | null {
    if (!this.engine) return null;

    const decisionJson = this.engine.decide();
    return decisionJson ? (JSON.parse(decisionJson) as EngineDecision) : null;
  }

  public reset() {
    this.engine = null;
  }
}
