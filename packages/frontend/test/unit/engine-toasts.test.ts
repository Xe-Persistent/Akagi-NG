import { describe, expect, it } from 'vitest';

import { TOAST_DURATION_DEFAULT, TOAST_DURATION_SHORT } from '@/config/constants';
import { projectNotices } from '@/hooks/useEngineToasts';
import type { EngineStatus } from '@/types';

function status(patch: Partial<EngineStatus> = {}): EngineStatus {
  return {
    connection: 'idle',
    model: 'idle',
    modelName: null,
    inference: 'local',
    notice: null,
    ...patch,
  };
}

describe('projecting engine status into toasts', () => {
  it('shows nothing for a healthy first snapshot', () => {
    expect(projectNotices(null, status({ connection: 'connected', model: 'ready' }))).toEqual([]);
  });

  it('repeats a standing model failure on hydration', () => {
    const notices = projectNotices(null, status({ model: 'failed' }));

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      messageKey: 'notify.model_error',
      type: 'error',
      autoClose: false,
    });
  });

  it('announces the client connection once', () => {
    const notices = projectNotices(status(), status({ connection: 'connected' }));

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      messageKey: 'notify.game_connected',
      type: 'success',
      autoClose: TOAST_DURATION_SHORT,
    });
  });

  it('names the local model when it is what answers', () => {
    const notices = projectNotices(
      status({ connection: 'connected', model: 'loading' }),
      status({ connection: 'connected', model: 'ready', modelName: 'akagi4p.safetensors' }),
    );

    expect(notices).toEqual([
      expect.objectContaining({
        messageKey: 'notify.model_loaded',
        autoClose: TOAST_DURATION_SHORT,
      }),
    ]);
  });

  it('names MJOT instead of the local model when online inference is usable', () => {
    const notices = projectNotices(
      status({ connection: 'connected', model: 'loading', inference: 'mjot' }),
      status({
        connection: 'connected',
        model: 'ready',
        modelName: 'akagi4p.safetensors',
        inference: 'mjot',
      }),
    );

    expect(notices).toEqual([
      expect.objectContaining({
        messageKey: 'notify.model_loaded_online',
        autoClose: TOAST_DURATION_SHORT,
      }),
    ]);
  });

  it('raises one toast per load, not a second "match ready" one', () => {
    const notices = projectNotices(
      status({ connection: 'connected', model: 'loading' }),
      status({ connection: 'connected', model: 'ready', modelName: 'm' }),
    );

    expect(notices.map((notice) => notice.messageKey)).toEqual(['notify.model_loaded']);
  });

  it.each([
    ['parse_failed', 'warning'],
    ['runtime_error', 'error'],
    ['syncing', 'info'],
    ['left_game', 'info'],
  ] as const)('maps the %s notice to its message', (kind, type) => {
    const notices = projectNotices(
      status({ connection: 'connected' }),
      status({ connection: 'connected', notice: { kind, seq: 1 } }),
    );

    expect(notices).toEqual([
      expect.objectContaining({
        // The kind *is* the key, by construction.
        messageKey: `notify.${kind}`,
        type,
        autoClose: TOAST_DURATION_DEFAULT,
      }),
    ]);
  });

  it('keeps a dropped connection on screen until it is closed', () => {
    const notices = projectNotices(
      status({ connection: 'connected' }),
      status({ connection: 'idle', notice: { kind: 'game_disconnected', seq: 1 } }),
    );

    expect(notices).toEqual([
      expect.objectContaining({
        id: 'notice:game_disconnected',
        messageKey: 'notify.game_disconnected',
        autoClose: false,
      }),
    ]);
  });

  it('does not repeat a notice the status is still carrying', () => {
    const carried = status({ connection: 'idle', notice: { kind: 'game_disconnected', seq: 4 } });

    expect(projectNotices(carried, status({ ...carried, model: 'idle' }))).toEqual([]);
  });

  it('shows a repeated notice again', () => {
    const notices = projectNotices(
      status({ connection: 'connected', notice: { kind: 'parse_failed', seq: 4 } }),
      status({ connection: 'connected', notice: { kind: 'parse_failed', seq: 5 } }),
    );

    expect(notices).toEqual([
      expect.objectContaining({ id: 'notice:parse_failed:5', messageKey: 'notify.parse_failed' }),
    ]);
  });

  it('retires the failure toast once a model loads', () => {
    const notices = projectNotices(
      status({ connection: 'connected', model: 'failed' }),
      status({ connection: 'connected', model: 'ready', modelName: 'm' }),
    );

    expect(notices).toEqual([expect.objectContaining({ dismisses: 'model:error' })]);
  });

  it('retires the dropped-connection toast once the client reconnects', () => {
    const notices = projectNotices(
      status({ connection: 'idle', notice: { kind: 'game_disconnected', seq: 1 } }),
      status({ connection: 'connected', notice: { kind: 'game_disconnected', seq: 1 } }),
    );

    expect(notices).toEqual([
      expect.objectContaining({
        messageKey: 'notify.game_connected',
        dismisses: 'notice:game_disconnected',
      }),
    ]);
  });
});
