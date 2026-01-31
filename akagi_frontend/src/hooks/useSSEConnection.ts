import { useEffect, useState } from 'react';

import { SSE_INITIAL_BACKOFF_MS, SSE_MAX_BACKOFF_MS, SSE_MAX_RETRIES } from '@/config/constants';
import type { FullRecommendationData, NotificationItem, SSEErrorCode } from '@/types';

interface UseSSEConnectionResult {
  data: FullRecommendationData | null;
  notifications: NotificationItem[];
  isConnected: boolean;
  error: SSEErrorCode | string | null;
}

export function useSSEConnection(url: string | null): UseSSEConnectionResult {
  const [data, setData] = useState<FullRecommendationData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<SSEErrorCode | string | null>(null);

  useEffect(() => {
    if (!url) return;

    let currentSource: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let backoff = SSE_INITIAL_BACKOFF_MS;
    let retryCount = 0;
    const maxBackoff = SSE_MAX_BACKOFF_MS;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;

      // 检查是否超过最大重试次数
      if (retryCount >= SSE_MAX_RETRIES) {
        setError('max_retries_exceeded');
        setIsConnected(false);
        return;
      }

      // 设置过渡状态，显示"重连中"而不是"已断开"
      setError('online_service_reconnecting');
      retryCount++;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        backoff = Math.min(backoff * 2, maxBackoff);
        connect();
      }, backoff);
    };

    const connect = () => {
      if (stopped) return;

      if (currentSource) {
        currentSource.close();
        currentSource = null;
      }

      let es: EventSource;
      try {
        es = new EventSource(url);
      } catch (e) {
        console.error('Invalid SSE URL:', e);
        setError('config_error');
        setIsConnected(false);
        scheduleReconnect();
        return;
      }

      currentSource = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        // 重连成功后重置重试计数器
        retryCount = 0;
        backoff = SSE_INITIAL_BACKOFF_MS;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
      };

      // 处理推荐数据事件
      es.addEventListener('recommendations', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          // 数据格式: { "recommendations": ..., "is_riichi": ... }
          setData(parsed);
        } catch (e) {
          console.error('Failed to parse recommendations', e);
        }
      });

      // 处理通知事件
      es.addEventListener('notification', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          // 预期格式: { "list": [...] }
          if (parsed.list) {
            setNotifications(parsed.list);
          }
        } catch (e) {
          console.error('Failed to parse notification', e);
        }
      });

      // 保留 onmessage 处理未命名事件
      es.onmessage = () => {
        // 空操作
      };

      es.onerror = (event) => {
        console.error('SSE error:', event);
        setIsConnected(false);
        setError('service_disconnected');
        if (es.readyState === EventSource.CLOSED) {
          scheduleReconnect();
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (currentSource) {
        currentSource.close();
      }
    };
  }, [url]);

  return { data, notifications, isConnected, error };
}
