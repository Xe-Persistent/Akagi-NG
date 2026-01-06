import { useEffect, useState } from 'react';
import type { FullRecommendationData } from '@/types';
import { useTranslation } from 'react-i18next';

interface UseSSEConnectionResult {
  data: FullRecommendationData | null;
  isConnected: boolean;
  error: string | null;
  systemError: { code: string; details: string } | null;
}

export function useSSEConnection(url: string | null): UseSSEConnectionResult {
  const [data, setData] = useState<FullRecommendationData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<{ code: string; details: string } | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!url) return;

    let currentSource: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let backoff = 1000;
    const maxBackoff = 30_000;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
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
        setError(t('app.config_error'));
        setIsConnected(false);
        scheduleReconnect();
        return;
      }

      currentSource = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        // Do not clear system error on reconnect, as it might persist on server
        backoff = 1000;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
      };

      es.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data);
          if (parsedData) {
            if (parsedData.type === 'system_error') {
              setSystemError({
                code: parsedData.error_code,
                details: parsedData.details,
              });
            } else if (parsedData.data) {
              setData(parsedData.data);
              // Clear system error if we receive normal data?
              // Maybe not, usually system error is fatal.
            }
          }
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      es.onerror = (event) => {
        console.error('SSE error:', event);
        setIsConnected(false);
        setError(t('app.connection_lost'));
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

  return { data, isConnected, error, systemError };
}
