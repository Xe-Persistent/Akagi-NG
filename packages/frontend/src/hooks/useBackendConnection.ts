import { useEffect, useMemo, useState } from 'react';

import type { ConnectionErrorCode, FullRecommendationData, NotificationItem } from '@/types';

interface UseBackendConnectionResult {
  data: FullRecommendationData | null;
  notifications: NotificationItem[];
  isConnected: boolean;
  error: ConnectionErrorCode | string | null;
}

export function useBackendConnection(): UseBackendConnectionResult {
  const [data, setData] = useState<FullRecommendationData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const [error, setError] = useState<ConnectionErrorCode | string | null>(null);

  useEffect(() => {
    if (!window.electron) {
      // 在下一次渲染周期更新
      queueMicrotask(() => setError('config_error'));
      return;
    }

    const unsubRecommendations = window.electron.on(
      'backend:recommendations',
      (payload: unknown) => {
        setData(payload as FullRecommendationData);
      },
    );

    const unsubNotification = window.electron.on('backend:notification', (payload: unknown) => {
      const parsed = payload as { list?: NotificationItem[] };
      if (parsed.list) {
        setNotifications(parsed.list);
      }
    });

    const unsubStatus = window.electron.on('backend:status', (payload: unknown) => {
      const { status } = payload as { status: string };
      setIsConnected(status === 'connected');
    });

    return () => {
      unsubRecommendations();
      unsubNotification();
      unsubStatus();
    };
  }, []);

  return useMemo(
    () => ({ data, notifications, isConnected, error }),
    [data, notifications, isConnected, error],
  );
}
