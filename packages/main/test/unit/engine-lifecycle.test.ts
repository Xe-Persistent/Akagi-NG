/**
 * The two things the capture layer tells the engine, and the status they leave
 * behind. Without a model loaded this is pure state, so it needs no engine.
 */
import { describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import { engineStatus } from '../../src/services/engine-status.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';

describe('what the capture layer reports', () => {
  it('opens the connection', () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      engine.clientConnected();

      expect(engineStatus.get().connection).toBe('connected');
      expect(messagesOn<{ connection: string }>('engine:status').at(-1)?.connection).toBe(
        'connected',
      );
    } finally {
      engine.stop();
    }
  });

  it('reports a game that ended as a return to the lobby', () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      engine.gameDisconnected(true);

      expect(engineStatus.get()).toMatchObject({ connection: 'idle', model: 'idle' });
      expect(engineStatus.get().notice?.kind).toBe('lobby_return');
    } finally {
      engine.stop();
    }
  });

  it('reports a game left mid-way as a drop', () => {
    resetSentMessages();
    const engine = new EngineService();

    try {
      engine.gameDisconnected(false);

      expect(engineStatus.get().notice?.kind).toBe('game_dropped');
    } finally {
      engine.stop();
    }
  });
});
