import type { Recommendation } from './services/engine/recommendation-mapper.js';
import type { ConnectionState, EngineNotice, ModelState } from './services/engine-status.js';

/** A canned HUD state: the hand it stands for, and what the engine would suggest. */
interface MockScenario {
  tehai: string[];
  recommendations: Recommendation[];
}

/**
 * The status an indicator should show, without the sequence number the store
 * assigns: one entry per state `model-status-indicator` can render.
 */
interface MockStatus {
  connection: ConnectionState;
  model: ModelState;
  modelName?: string;
  /** A one-shot event to raise together with the state, to exercise the toasts. */
  notice?: EngineNotice['kind'];
}

/** One tick of the mock stream: what the HUD shows and what the engine reports. */
export interface MockFrame {
  recommendations: Recommendation[];
  status: MockStatus;
}

const SCENARIOS: MockScenario[] = [
  // 场景 1：普通打牌
  {
    tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '1p', '5p', '0p', '9p', 'E', 'E', 'W'],
    recommendations: [
      { action: 'W', confidence: 0.85 },
      { action: '9p', confidence: 0.1 },
      { action: '1p', confidence: 0.05 },
    ],
  },
  // 场景 2：立直前瞻（类似二杯口的形态）
  {
    tehai: ['1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m', '7m', '7m', '8m'],
    recommendations: [
      {
        action: 'reach',
        confidence: 0.92,
        sim_candidates: [
          { tile: '8m', confidence: 0.95 },
          { tile: '1m', confidence: 0.05 },
        ],
      },
      { action: '8m', confidence: 0.05 }, // Dama
      { action: '1m', confidence: 0.03 }, // Dama
    ],
  },

  // 场景 3：混合杠（暗杠 5m + 加杠 7s）
  {
    // The 7s is the fourth copy of a pon that is already on the table.
    tehai: ['5m', '5mr', '5m', '5m', '6m', '7m', 'E', 'E', 'E', '7s', '1p', '2p', '3p'],
    recommendations: [
      { action: 'kan', confidence: 0.9, tile: '5m', consumed: ['5m', '5mr', '5m', '5m'] }, // Ankan
      { action: 'kan', confidence: 0.9, tile: '7s', consumed: ['7s'] }, // Kakan
      { action: '7s', confidence: 0.1 }, // Skip kan
    ],
  },
  // 场景 4：碰 vs 大明杠（对手打出 9p）
  {
    tehai: ['9p', '9p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', 'E', 'E', 'S', 'S'],
    recommendations: [
      { action: 'kan', confidence: 0.9, tile: '9p', consumed: ['9p', '9p', '9p'] }, // Daiminkan (consumes 3 from hand)
      { action: 'pon', confidence: 0.08, tile: '9p', consumed: ['9p', '9p'] }, // Pon (consumes 2 from hand)
      { action: 'none', confidence: 0.02 },
    ],
  },
  // 场景 5：吃 - 对手打出 7m
  // 手牌：56m ...
  {
    tehai: ['5m', '6m', '8m', '9m', '1p', '2p', '3p', '4s', '5s', '6s', 'E', 'E', 'W'],
    recommendations: [
      { action: 'chi', confidence: 0.85, tile: '7m', consumed: ['5m', '6m'] }, // Chi 7m with 56m
      { action: 'none', confidence: 0.15 },
    ],
  },
  // 场景 6：荣和
  {
    tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m'],
    recommendations: [
      { action: 'ron', confidence: 0.99, tile: '9m' },
      { action: 'none', confidence: 0.01 },
    ],
  },
  // 场景 7：自摸
  {
    tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m', '9m'],
    recommendations: [
      { action: 'tsumo', confidence: 0.99, tile: '9m' },
      { action: 'none', confidence: 0.01 },
    ],
  },
  // 场景 8：拔北
  {
    tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '2p', '3p', '9p', '9p', 'N', 'E'],
    recommendations: [
      { action: 'nukidora', confidence: 0.9, tile: 'N' },
      { action: '9p', confidence: 0.05 },
      { action: 'E', confidence: 0.05 },
    ],
  },
  // 场景 9：流局（九种九牌）
  {
    tehai: ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'P', 'F', 'C', '1m'],
    recommendations: [
      { action: 'ryukyoku', confidence: 0.8 },
      { action: '9m', confidence: 0.15 },
      { action: 'C', confidence: 0.05 },
    ],
  },
];

/**
 * The status rotation: every state the indicator can show, each paired with the
 * one-shot event that belongs with it, so a `dev:mock` run visits them all.
 */
const STATUSES: MockStatus[] = [
  // Blue dot: a game is open and the local model is answering.
  { connection: 'connected', model: 'ready', modelName: 'akagi4p.safetensors' },
  // Amber pulse: the model is being loaded.
  { connection: 'connected', model: 'loading' },
  // Dark red dot, with the error the runtime reported.
  { connection: 'connected', model: 'failed', modelName: 'akagi4p.safetensors' },
  // Red pulse: the game connection dropped on its own.
  { connection: 'idle', model: 'idle', notice: 'game_dropped' },
  // No dot: connected, but no game has started yet.
  { connection: 'connected', model: 'idle', notice: 'replay' },
];

/**
 * The stand-in for the engine that `npm run dev:mock` streams into the HUD: one
 * scenario and one status per tick, so the recommendations and the indicator can
 * both be checked without a model or a table.
 */
export function generateMockData(counter: number): MockFrame {
  return {
    recommendations: SCENARIOS[counter % SCENARIOS.length].recommendations,
    status: STATUSES[counter % STATUSES.length],
  };
}
