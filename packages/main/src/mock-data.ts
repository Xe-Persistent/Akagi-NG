import type { Recommendation } from './services/engine/recommendation-mapper.js';
import type { ConnectionState, EngineNotice, ModelState } from './services/engine-status.js';

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

/**
 * The recommendation rotation. The mock stream carries no hand, so each entry
 * keeps the hand it was written for as a comment: without it the suggestions
 * below are unreadable.
 */
const SCENARIOS: Recommendation[][] = [
  // Scenario 1: a plain discard.
  // Hand: 1m 2m 3m 5m 6m 7m 1p 1p 5p 0p 9p E E W
  [
    { action: 'W', confidence: 0.85 },
    { action: '9p', confidence: 0.1 },
    { action: '1p', confidence: 0.05 },
  ],
  // Scenario 2: riichi lookahead, the shape of a two-sided wait.
  // Hand: 1m 2m 2m 3m 3m 4m 4m 5m 5m 6m 6m 7m 7m 8m
  [
    {
      action: 'reach',
      confidence: 0.92,
      sim_candidates: [
        { tile: '8m', confidence: 0.95 },
        { tile: '1m', confidence: 0.05 },
      ],
    },
    { action: '8m', confidence: 0.05 }, // dama
    { action: '1m', confidence: 0.03 }, // dama
  ],
  // Scenario 3: both kan kinds, a closed 5m and an added 7s.
  // Hand: 5m 5mr 5m 5m 6m 7m E E E 7s 1p 2p 3p
  [
    { action: 'kan', confidence: 0.9, tile: '5m', consumed: ['5m', '5mr', '5m', '5m'] }, // ankan
    // The 7s is the fourth copy of a pon that is already on the table.
    { action: 'kan', confidence: 0.9, tile: '7s', consumed: ['7s'] }, // kakan
    { action: '7s', confidence: 0.1 }, // decline the kan
  ],
  // Scenario 4: pon or open kan on a discarded 9p.
  // Hand: 9p 9p 9p 1s 2s 3s 4s 5s 6s E E S S
  [
    { action: 'kan', confidence: 0.9, tile: '9p', consumed: ['9p', '9p', '9p'] }, // daiminkan
    { action: 'pon', confidence: 0.08, tile: '9p', consumed: ['9p', '9p'] }, // pon
    { action: 'none', confidence: 0.02 },
  ],
  // Scenario 5: chi on a discarded 7m.
  // Hand: 5m 6m 8m 9m 1p 2p 3p 4s 5s 6s E E W
  [
    { action: 'chi', confidence: 0.85, tile: '7m', consumed: ['5m', '6m'] }, // chi 7m with 56m
    { action: 'none', confidence: 0.15 },
  ],
  // Scenario 6: ron.
  // Hand: 1m 2m 3m 4m 5m 6m 7p 8p 9p 1s 2s 3s 9m
  [
    { action: 'ron', confidence: 0.99, tile: '9m' },
    { action: 'none', confidence: 0.01 },
  ],
  // Scenario 7: tsumo.
  // Hand: 1m 2m 3m 4m 5m 6m 7p 8p 9p 1s 2s 3s 9m 9m
  [
    { action: 'tsumo', confidence: 0.99, tile: '9m' },
    { action: 'none', confidence: 0.01 },
  ],
  // Scenario 8: nukidora.
  // Hand: 1m 2m 3m 5m 6m 7m 1p 2p 3p 9p 9p N E
  [
    { action: 'nukidora', confidence: 0.9, tile: 'N' },
    { action: '9p', confidence: 0.05 },
    { action: 'E', confidence: 0.05 },
  ],
  // Scenario 9: drawn round on nine terminals and honours.
  // Hand: 1m 9m 1p 9p 1s 9s E S W N P F C 1m
  [
    { action: 'ryukyoku', confidence: 0.8 },
    { action: '9m', confidence: 0.15 },
    { action: 'C', confidence: 0.05 },
  ],
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
    recommendations: SCENARIOS[counter % SCENARIOS.length],
    status: STATUSES[counter % STATUSES.length],
  };
}
