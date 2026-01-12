import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import type { StatusDomain, StatusLevel } from '../config/statusConfig';
import { getStatusConfig } from '../config/statusConfig';
import type { NotificationItem } from '@/types';

const DOMAIN_PRIORITY: Record<StatusDomain, number> = {
  connection: 0,
  service: 1,
  model: 2,
  runtime: 3,
  game: 4,
};

const LEVEL_PRIORITY: Record<StatusLevel, number> = {
  error: 0,
  warning: 1,
  success: 2,
  info: 3,
};

export function useStatusNotification(
  notifications: NotificationItem[],
  connectionError: string | null,
) {
  const { t } = useTranslation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<StatusLevel>('info');

  // 合并后端通知和连接错误
  const allNotifications = useMemo(() => {
    const list = [...notifications];

    if (connectionError) {
      list.push({ code: connectionError, level: 'error' });
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
      if (config.placement === 'toast') {
        const autoClose = config.lifecycle === 'ephemeral' ? config.autoHide || 5000 : false;

        toast(message, {
          type: config.level,
          autoClose,
          toastId: note.code,
        });
      }

      // 处理状态栏
      if (config.placement === 'status') {
        statusCandidates.push({
          message,
          level: config.level || 'info',
          domain: config.domain || 'runtime',
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
