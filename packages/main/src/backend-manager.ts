import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AkagiEngine } from '@akagi-ng/rust-engine';
import { BrowserWindow } from 'electron';

import { BACKEND_READY_TIMEOUT_MS } from './constants.js';
import { createLogger } from './logger.js';
import type { ResourceStatus } from './resource-validator.js';
import { ResourceValidator } from './resource-validator.js';
import type { AkagiEvent, StartGameEvent } from './schema/mjai.js';
import { NotificationCode } from './schema/mjai.js';
import { settingsManager } from './settings-manager.js';
import { getProjectRoot } from './utils.js';

const logger = createLogger('BackendManager');

interface BotAction {
  type: string;
  pai?: string;
  target?: number;
  consumed?: string[];
  tsumogiri?: boolean;
}

interface Decision {
  action: BotAction;
  candidates: [BotAction, number][];
  logits: number[];
}

interface Recommendation {
  action: string;
  tile?: string;
  consumed?: string[];
  confidence: number;
}

export class BackendManager {
  private validator: ResourceValidator;
  private isMockMode: boolean = false;

  private engine: AkagiEngine | null = null;
  private playerId: number = -1;
  private is3p: boolean = false;
  private isReacting: boolean = false;

  public getMitmConfig(): { host: string; port: number } {
    const settings = settingsManager.getSettings();
    return {
      host: settings.mitm?.host ?? '127.0.0.1',
      port: settings.mitm?.port ?? 6789,
    };
  }

  public isRunning(): boolean {
    return true; // The engine is integrated directly, always "running"
  }

  constructor() {
    this.validator = new ResourceValidator(getProjectRoot());
  }

  public async getResourceStatus(): Promise<ResourceStatus> {
    return await this.validator.validate();
  }

  public start() {
    if (process.argv.includes('--mock')) {
      this.isMockMode = true;
    }
  }

  public async waitForReady(_timeoutMs: number = BACKEND_READY_TIMEOUT_MS): Promise<boolean> {
    return true; // NAPI extension loads synchronously
  }

  public async stop() {
    this.engine = null;
  }

  public ingest(events: AkagiEvent[]) {
    for (const ev of events) {
      if (ev.type === 'start_game') {
        const start = ev as StartGameEvent;
        this.playerId = start.id;
        this.is3p = start.is_3p;

        // Initialize the local engine
        const settings = settingsManager.getSettings();
        if (!this.isMockMode) {
          const modelName = this.is3p
            ? settings.model_config.model_3p
            : settings.model_config.model_4p;
          const modelPath = join(getProjectRoot(), 'models', modelName);
          if (existsSync(modelPath)) {
            try {
              const buf = readFileSync(modelPath);
              this.engine = new AkagiEngine(buf, this.is3p ? 3 : 4, this.playerId);
              this.engine.feedLine(JSON.stringify(ev));
            } catch (err) {
              logger.error('Failed to load local model:', err);
              this.sendNotification('error', NotificationCode.MODEL_LOAD_FAILED);
            }
          } else {
            logger.error('Local model not found at path:', modelPath);
            this.sendNotification('error', NotificationCode.MODEL_LOAD_FAILED);
          }
        } else {
          this.engine = null;
        }
      } else {
        this.engine?.feedLine(JSON.stringify(ev));
      }

      // React to decision points
      if (this.isDecisionPoint(ev)) {
        this.react();
      }
    }
  }

  private isDecisionPoint(ev: AkagiEvent): boolean {
    if (ev.type === 'tsumo' && ev.actor === this.playerId) return true;
    if (ev.type === 'dahai' && ev.actor !== this.playerId) return true;
    if (ev.type === 'kakan' || ev.type === 'nukidora') return true;
    return false;
  }

  private async react() {
    if (this.isReacting) return;
    this.isReacting = true;

    try {
      let recommendations: Recommendation[] = [];

      if (this.isMockMode) {
        recommendations = [{ action: 'dahai', tile: '1m', confidence: 0.99 }];
      } else if (this.engine) {
        const decisionStr = this.engine.decide();
        if (decisionStr) {
          const decision: Decision = JSON.parse(decisionStr);
          recommendations = this.mapLocalDecision(decision);
        }
      }

      if (recommendations.length > 0) {
        const payload = {
          type: 'recommendations',
          recommendations,
          engine_type: this.engine || this.isMockMode ? 'local' : 'null',
        };
        this.broadcast(`backend:recommendations`, payload);
      }
    } catch (e) {
      logger.error('Error in react():', e);
    } finally {
      this.isReacting = false;
    }
  }

  private mapLocalDecision(decision: Decision): Recommendation[] {
    return decision.candidates.map(([botAction, prob]) => {
      return {
        action: botAction.type,
        tile: botAction.pai,
        confidence: prob,
        consumed: botAction.consumed,
      };
    });
  }

  private sendNotification(
    level: 'error' | 'warning' | 'info' | 'success',
    code: NotificationCode,
  ) {
    this.broadcast(`backend:notification`, {
      list: [{ level, code }],
    });
  }

  private broadcast(channel: string, data: unknown) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}
