import { describe, expect, it } from 'vitest';

import { ACTION_CONFIG, SHOW_CONSUMED_ACTIONS } from '@/config/actionConfig';
import { TOAST_DURATION_DEFAULT } from '@/config/constants';
import { notify } from '@/lib/notify';

import { toast } from '../react-toastify-stub';

describe('the toast wrapper', () => {
  it.each([
    ['success', 'success'],
    ['error', 'error'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['loading', 'loading'],
    ['show', undefined],
  ] as const)('sends %s through the matching toast', (method, expected) => {
    toast.calls.length = 0;

    notify[method]('message');

    expect(toast.calls).toHaveLength(1);
    expect(toast.calls[0]).toMatchObject({ kind: expected ?? 'show', message: 'message' });
  });

  it('applies the shared defaults to every kind', () => {
    toast.calls.length = 0;

    notify.success('saved');

    expect(toast.calls[0]!.options).toMatchObject({
      position: 'top-right',
      autoClose: TOAST_DURATION_DEFAULT,
      closeOnClick: true,
      pauseOnHover: true,
    });
  });

  it('lets the caller override a default', () => {
    toast.calls.length = 0;

    notify.error('failed', { autoClose: false, position: 'bottom-center' });

    expect(toast.calls[0]!.options).toMatchObject({
      autoClose: false,
      position: 'bottom-center',
      // The defaults the caller did not mention are still applied.
      closeOnClick: true,
    });
  });

  it('updates and dismisses an existing toast', () => {
    toast.calls.length = 0;

    notify.update(7, { render: 'done' });
    notify.dismiss(7);

    expect(toast.calls).toEqual([
      { kind: 'update', id: 7, options: expect.objectContaining({ render: 'done' }) },
      { kind: 'dismiss', id: 7 },
    ]);
  });
});

describe('the action table', () => {
  it('gives every action a label, a colour and a gradient', () => {
    for (const [action, config] of Object.entries(ACTION_CONFIG)) {
      expect(config.label, action).toMatch(/^actions\.\w+$/);
      expect(config.color, action).toMatch(/^var\(--color-action-[\w-]+\)$/);
      expect(config.gradient, action).toMatch(/^from-[\w-]+ to-[\w-]+$/);
    }
  });

  it('uses a distinct colour per action', () => {
    const colours = Object.values(ACTION_CONFIG).map((config) => config.color);

    expect(new Set(colours).size).toBe(colours.length);
  });

  it('shows the consumed tiles of exactly the calls that took tiles from the table', () => {
    expect([...SHOW_CONSUMED_ACTIONS].sort()).toEqual(['chi', 'kan', 'pon']);
    for (const action of SHOW_CONSUMED_ACTIONS) expect(ACTION_CONFIG[action]).toBeDefined();
  });
});
