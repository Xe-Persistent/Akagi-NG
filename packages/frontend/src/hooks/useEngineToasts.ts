import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { TOAST_DURATION_DEFAULT, TOAST_DURATION_SHORT } from '@/config/constants';
import { notify } from '@/lib/notify';
import type { EngineNotice, EngineStatus } from '@/types';

/** The toast types this hook can raise; the label decides which one. */
type ToastType = 'info' | 'success' | 'warning' | 'error';

/** A message the user should see, derived from a status change. */
interface Notice {
  /** Stable per occurrence, so a repeated event shows again. */
  id: string;
  messageKey: string;
  type: ToastType;
  autoClose: number | false;
}

/** Messages for the one-shot events, keyed by the kind the main process sends. */
const NOTICE_MESSAGES: Record<EngineNotice['kind'], { messageKey: string; type: Notice['type'] }> =
  {
    parse_error: { messageKey: 'status.parse_failed', type: 'warning' },
    runtime_error: { messageKey: 'status.runtime_error', type: 'error' },
    replay: { messageKey: 'status.syncing', type: 'info' },
    lobby_return: { messageKey: 'status.left_game', type: 'info' },
    game_dropped: { messageKey: 'status.disconnected', type: 'info' },
  };

/**
 * Projects the engine status into toasts: state transitions and one-shot notices
 * are turned into messages here and nowhere else, so what the user sees follows
 * from the status the main process reports.
 */
export function useEngineToasts(status: EngineStatus | null) {
  const { t } = useTranslation();
  const previousRef = useRef<EngineStatus | null>(null);

  /** Shows what the projection produced, in whichever language is current then. */
  const showNotices = useEffectEvent((notices: Notice[]) => {
    for (const notice of notices) {
      notify.show(t(notice.messageKey), {
        toastId: notice.id,
        type: notice.type,
        autoClose: notice.autoClose,
      });
    }
  });

  useEffect(() => {
    if (!status) return;

    const notices = project(previousRef.current, status);
    previousRef.current = status;
    showNotices(notices);
  }, [status]);
}

/** The transitions and notices worth a message, in the order they are shown. */
function project(before: EngineStatus | null, now: EngineStatus): Notice[] {
  // The first snapshot only hydrates the view: nothing happened while this window
  // was closed, so only a standing problem is worth repeating.
  if (!before) {
    return now.model === 'failed'
      ? [
          {
            id: 'model:failed',
            messageKey: 'status.model_failed',
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
      messageKey: 'status.client_connected',
      type: 'success',
      autoClose: TOAST_DURATION_SHORT,
    });
  }

  if (before.model !== 'ready' && now.model === 'ready') {
    notices.push({
      id: `model:ready:${now.modelName ?? ''}`,
      messageKey: 'status.model_loaded',
      type: 'success',
      autoClose: TOAST_DURATION_SHORT,
    });
    if (now.connection === 'connected') {
      notices.push({
        id: `game:ready:${now.modelName ?? ''}`,
        messageKey: 'status.game_ready',
        type: 'success',
        autoClose: TOAST_DURATION_SHORT,
      });
    }
  }

  if (before.model !== 'failed' && now.model === 'failed') {
    notices.push({
      id: 'model:failed',
      messageKey: 'status.model_failed',
      type: 'error',
      autoClose: false,
    });
  }

  // One-shot events: the sequence number makes a repeat a new toast; the ones
  // that stay until they are resolved replace their previous occurrence instead.
  if (now.notice && now.notice.seq !== before.notice?.seq) {
    const { messageKey, type } = NOTICE_MESSAGES[now.notice.kind];
    const persistent = now.notice.kind === 'game_dropped';
    notices.push({
      id: persistent ? `notice:${now.notice.kind}` : `notice:${now.notice.kind}:${now.notice.seq}`,
      messageKey,
      type,
      autoClose: persistent ? false : TOAST_DURATION_DEFAULT,
    });
  }

  return notices;
}
