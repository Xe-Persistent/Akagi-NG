import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { getStatusConfig } from '../config/statusConfig';
import {
  STATUS_DOMAIN,
  STATUS_LEVEL,
  STATUS_LIFECYCLE,
  STATUS_PLACEMENT,
  type StatusDomain,
  type StatusLevel,
} from '../config/statusConstants';
import { TOAST_DURATION_DEFAULT } from '../config/constants';
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<StatusLevel>(STATUS_LEVEL.INFO);
  const [activeStatusCode, setActiveStatusCode] = useState<string | null>(null);
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

  useEffect(() => {
    if (allNotifications.length === 0) {
      setStatusMessage(null);
      // 清除所有活跃的 toast
      activeToastIds.current.forEach((toastId) => {
        toast.dismiss(toastId);
      });
      activeToastIds.current.clear();
      return;
    }

    const statusCandidates: Array<{
      code: string;
      message: string;
      level: StatusLevel;
      domain: StatusDomain;
      lifecycle: string;
      autoHide?: number;
    }> = [];

    const currentToastIds = new Set<string>();

    allNotifications.forEach((note) => {
      const config = getStatusConfig(note.code);
      const message = t(`status_messages.${config.messageKey || note.code}`, {
        defaultValue: note.msg || '',
        details: note.msg,
      });

      // 处理 Toast 通知
      if (config.placement === STATUS_PLACEMENT.TOAST) {
        const autoClose =
          config.lifecycle === STATUS_LIFECYCLE.EPHEMERAL
            ? config.autoHide || TOAST_DURATION_DEFAULT
            : false;

        toast(message, {
          type: config.level,
          autoClose,
          toastId: note.code,
        });

        // 记录当前应该活跃的 toast
        currentToastIds.add(note.code);
      }

      // 处理状态栏
      if (config.placement === STATUS_PLACEMENT.STATUS) {
        // 如果已经被手动隐藏（自动消失），则不再显示
        if (!hiddenCodes.has(note.code)) {
          statusCandidates.push({
            code: note.code,
            message,
            level: config.level || STATUS_LEVEL.INFO,
            domain: config.domain || STATUS_DOMAIN.RUNTIME,
            lifecycle: config.lifecycle,
            autoHide: config.autoHide,
          });
        }
      }
    });

    // 清除不再需要的 toast
    activeToastIds.current.forEach((toastId) => {
      if (currentToastIds.has(toastId)) return;
      const config = getStatusConfig(toastId);
      // 不要自动清除临时通知，让它们自然过期
      if (config.lifecycle === STATUS_LIFECYCLE.EPHEMERAL) return;
      toast.dismiss(toastId);
    });

    // 更新活跃的 toast 列表
    activeToastIds.current = currentToastIds;

    // 确定状态栏显示内容
    if (statusCandidates.length > 0) {
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
      setStatusMessage(winner.message);
      setStatusType(winner.level);
      setActiveStatusCode(winner.code);
    } else {
      setStatusMessage(null);
      setActiveStatusCode(null);
    }
  }, [allNotifications, t, hiddenCodes]);

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
  }, [allNotifications]);

  return { statusMessage, statusType };
}
