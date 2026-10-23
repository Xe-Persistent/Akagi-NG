import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { TOAST_DURATION_DEFAULT, TOAST_DURATION_SHORT } from '@/config/constants';
import { notify } from '@/lib/notify';
import type { EngineNotice, EngineStatus } from '@/types';

/** The toast types this hook can raise; the label decides which one. */
type ToastType = 'info' | 'success' | 'warning' | 'error';

/** A message the user should see, derived from a status change. */
export interface Notice {
  /** Stable per occurrence, so a repeated event shows again. */
  id: string;
  messageKey: string;
  type: ToastType;
  autoClose: number | false;
  /** A standing toast this event resolves, dismissed before the new one shows. */
  dismisses?: string;
}

/** One shot id per persistent kind, so the producer and the dismisser agree. */
const persistentToastId = (kind: EngineNotice['kind']) => `notice:${kind}`;

/** The standing error a successful load retires. */
const MODEL_ERROR_TOAST = 'model:error';

/**
 * Messages for the one-shot events, keyed by `EngineNotice['kind']`. The key is
 * also the `notify.*` suffix the message lives under, so the two vocabularies
 * cannot drift apart: renaming a kind renames its translation key with it.
 */
const NOTICE_MESSAGES: Record<EngineNotice['kind'], { type: Notice['type']; persistent: boolean }> =
  {
    parse_failed: { type: 'warning', persistent: false },
    runtime_error: { type: 'error', persistent: false },
    syncing: { type: 'info', persistent: false },
    left_game: { type: 'info', persistent: false },
    game_disconnected: { type: 'info', persistent: true },
  };

/**
 * Projects the engine status into toasts: state transitions and one-shot notices
 * are turned into messages here and nowhere else, so what the user sees follows
 * from the status the main process reports.
 *
 * `showToasts` is false in the HUD, which has no container to render them: the
 * calls would only pile up in that window's toast store.
 */
export function useEngineToasts(status: EngineStatus | null, showToasts = true) {
  const { t } = useTranslation();
  const previousRef = useRef<EngineStatus | null>(null);

  /** Shows what the projection produced, in whichever language is current then. */
  const showNotices = useEffectEvent((notices: Notice[]) => {
    if (!showToasts) return;
    for (const notice of notices) {
      if (notice.dismisses) notify.dismiss(notice.dismisses);
      notify.show(t(notice.messageKey), {
        toastId: notice.id,
        type: notice.type,
        autoClose: notice.autoClose,
      });
    }
  });

  useEffect(() => {
    if (!status) return;

    const notices = projectNotices(previousRef.current, status);
    previousRef.current = status;
    showNotices(notices);
  }, [status]);
}

/** The transitions and notices worth a message, in the order they are shown. */
export function projectNotices(before: EngineStatus | null, now: EngineStatus): Notice[] {
  // The first snapshot only hydrates the view: nothing happened while this window
  // was closed, so only a standing problem is worth repeating.
  if (!before) {
    return now.model === 'failed'
      ? [
          {
            id: MODEL_ERROR_TOAST,
            messageKey: 'notify.model_error',
            type: 'error',
            autoClose: false,
          },
        ]
      : [];
  }

  const notices: Notice[] = [];

  if (before.connection !== 'connected' && now.connection === 'connected') {
    notices.push({
      id: `connection:connected:${now.notice?.seq ?? 0}`,
      messageKey: 'notify.game_connected',
      type: 'success',
      autoClose: TOAST_DURATION_SHORT,
      // The drop it announces is over; leaving its warning up would contradict
      // the toast now on screen.
      dismisses: persistentToastId('game_disconnected'),
    });
  }

  if (before.model !== 'ready' && now.model === 'ready') {
    // The local model is always loaded — it is the legal-action gate and the
    // fallback — so naming it alone reads as "local inference is what you get"
    // even when MJOT is the model actually answering.
    notices.push({
      id: `model:ready:${now.modelName ?? ''}`,
      messageKey: now.inference === 'mjot' ? 'notify.model_loaded_online' : 'notify.model_loaded',
      type: 'success',
      autoClose: TOAST_DURATION_SHORT,
      // A load that succeeds resolves the standing failure toast.
      dismisses: MODEL_ERROR_TOAST,
    });
  }

  if (before.model !== 'failed' && now.model === 'failed') {
    notices.push({
      id: MODEL_ERROR_TOAST,
      messageKey: 'notify.model_error',
      type: 'error',
      autoClose: false,
    });
  }

  // One-shot events: the sequence number makes a repeat a new toast; the ones
  // that stay until they are resolved replace their previous occurrence instead.
  if (now.notice && now.notice.seq !== before.notice?.seq) {
    const { kind } = now.notice;
    const { type, persistent } = NOTICE_MESSAGES[kind];
    notices.push({
      id: persistent ? persistentToastId(kind) : `notice:${kind}:${now.notice.seq}`,
      messageKey: `notify.${kind}`,
      type,
      autoClose: persistent ? false : TOAST_DURATION_DEFAULT,
    });
  }

  return notices;
}
