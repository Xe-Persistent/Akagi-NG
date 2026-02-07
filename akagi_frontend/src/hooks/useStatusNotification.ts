import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import { TOAST_DURATION_DEFAULT } from '@/config/constants';
import { getStatusConfig } from '@/config/statusConfig';
import {
  STATUS_DOMAIN,
  STATUS_LEVEL,
  STATUS_LIFECYCLE,
  STATUS_PLACEMENT,
  type StatusDomain,
  type StatusLevel,
} from '@/config/statusConstants';
import type { NotificationItem } from '@/types';

const DOMAIN_PRIORITY: Record<StatusDomain, number> = {
  [STATUS_DOMAIN.CONNECTION]: 0,
  [STATUS_DOMAIN.SERVICE]: 1,
  [STATUS_DOMAIN.MODEL]: 2,
  [STATUS_DOMAIN.RUNTIME]: 3,
  [STATUS_DOMAIN.GAME]: 4,
};

const LEVEL_PRIORITY: Record<StatusLevel, number> = {
  [STATUS_LEVEL.ERROR]: 0,
  [STATUS_LEVEL.WARNING]: 1,
  [STATUS_LEVEL.SUCCESS]: 2,
  [STATUS_LEVEL.INFO]: 3,
};

export function useStatusNotification(
  notifications: NotificationItem[],
  connectionError: string | null,
) {
  const { t } = useTranslation();
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(new Set());
  const activeToastIds = useRef<Set<string>>(new Set());

  // 合并后端通知和连接错误
  const allNotifications = useMemo(() => {
    const list = [...notifications];
    if (connectionError) {
      list.push({ code: connectionError, level: STATUS_LEVEL.ERROR });
    }
    return list;
  }, [notifications, connectionError]);
  // 确定状态栏显示内容
  const { statusMessage, statusType, activeStatusCode } = useMemo(() => {
    // 过滤出候选状态
    const statusCandidates = allNotifications
      .map((note) => {
        const config = getStatusConfig(note.code);
        // 只处理 STATUS_PLACEMENT.STATUS
        if (config.placement !== STATUS_PLACEMENT.STATUS) return null;
        if (hiddenCodes.has(note.code)) return null;

        const message = t(`status_messages.${config.messageKey || note.code}`, {
          defaultValue: note.msg || '',
          details: note.msg,
        });

        return {
          code: note.code,
          message,
          level: config.level || STATUS_LEVEL.INFO,
          domain: config.domain || STATUS_DOMAIN.RUNTIME,
          lifecycle: config.lifecycle,
          autoHide: config.autoHide,
        };
      })
      .filter((item) => item !== null);

    if (statusCandidates.length === 0) {
      return { statusMessage: null, statusType: STATUS_LEVEL.INFO, activeStatusCode: null };
    }

    // 排序
    statusCandidates.sort((a, b) => {
      const lA = LEVEL_PRIORITY[a.level] ?? 99;
      const lB = LEVEL_PRIORITY[b.level] ?? 99;
      if (lA !== lB) return lA - lB;

      const dA = DOMAIN_PRIORITY[a.domain] ?? 99;
      const dB = DOMAIN_PRIORITY[b.domain] ?? 99;
      if (dA !== dB) return dA - dB;

      return 0;
    });

    const winner = statusCandidates[0];
    return {
      statusMessage: winner.message,
      statusType: winner.level,
      activeStatusCode: winner.code,
    };
  }, [allNotifications, hiddenCodes, t]);

  // 处理 Toast
  useEffect(() => {
    // 1. 识别活动的通知
    const currentToastIds = new Set<string>();

    allNotifications.forEach((note) => {
      const config = getStatusConfig(note.code);
      if (config.placement === STATUS_PLACEMENT.TOAST) {
        currentToastIds.add(note.code);

        if (!activeToastIds.current.has(note.code)) {
          const message = t(`status_messages.${config.messageKey || note.code}`, {
            defaultValue: note.msg || '',
            details: note.msg,
          });
          const autoClose =
            config.lifecycle === STATUS_LIFECYCLE.EPHEMERAL
              ? config.autoHide || TOAST_DURATION_DEFAULT
              : false;

          toast(message, {
            type: config.level,
            autoClose,
            toastId: note.code,
          });
        }
      }
    });

    // 2. 关闭需要移除的通知
    activeToastIds.current.forEach((toastId) => {
      if (currentToastIds.has(toastId)) return;
      const config = getStatusConfig(toastId);
      // 不要自动清除临时通知，让它们自然过期
      if (config.lifecycle === STATUS_LIFECYCLE.EPHEMERAL) return;

      toast.dismiss(toastId);
    });

    activeToastIds.current = currentToastIds;
  }, [allNotifications, t]);

  // 处理临时状态的自动消失
  useEffect(() => {
    if (!activeStatusCode) return;

    const config = getStatusConfig(activeStatusCode);
    if (
      config.placement === STATUS_PLACEMENT.STATUS &&
      config.lifecycle === STATUS_LIFECYCLE.EPHEMERAL
    ) {
      const duration = config.autoHide || TOAST_DURATION_DEFAULT;
      const timer = setTimeout(() => {
        setHiddenCodes((prev) => {
          const next = new Set(prev);
          next.add(activeStatusCode);
          return next;
        });
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [activeStatusCode]);

  // 清理不再存在的 hiddenCodes
  useEffect(() => {
    const timer = setTimeout(() => {
      setHiddenCodes((prev) => {
        const currentCodes = new Set(allNotifications.map((n) => n.code));
        let hasChanges = false;
        const next = new Set(prev);

        next.forEach((code) => {
          if (!currentCodes.has(code)) {
            next.delete(code);
            hasChanges = true;
          }
        });

        return hasChanges ? next : prev;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [allNotifications]);

  return { statusMessage, statusType };
}
