import { useEffect, useMemo, useState } from 'react';
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
      return;
    }

    const statusCandidates: Array<{
      message: string;
      level: StatusLevel;
      domain: StatusDomain;
    }> = [];

    allNotifications.forEach((note) => {
      const config = getStatusConfig(note.code);
      const message = t(`status_messages.${config.messageKey || note.code}`, {
        defaultValue: note.msg || '',
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
      }

      // 处理状态栏
      if (config.placement === STATUS_PLACEMENT.STATUS) {
        statusCandidates.push({
          message,
          level: config.level || STATUS_LEVEL.INFO,
          domain: config.domain || STATUS_DOMAIN.RUNTIME,
        });
      }
    });

    // 确定状态栏显示内容
    if (statusCandidates.length > 0) {
      statusCandidates.sort((a, b) => {
        const dA = DOMAIN_PRIORITY[a.domain] ?? 99;
        const dB = DOMAIN_PRIORITY[b.domain] ?? 99;
        if (dA !== dB) return dA - dB;

        const lA = LEVEL_PRIORITY[a.level] ?? 99;
        const lB = LEVEL_PRIORITY[b.level] ?? 99;
        return lA - lB;
      });

      const winner = statusCandidates[0];
      setStatusMessage(winner.message);
      setStatusType(winner.level);
    } else {
      setStatusMessage(null);
    }
  }, [allNotifications, t]);

  return { statusMessage, statusType };
}
