import {useEffect, useState} from 'react';
import type {FullRecommendationData} from '@/components/types';

interface UseSSEConnectionResult {
    data: FullRecommendationData | null;
    isConnected: boolean;
    error: string | null;
}

export function useSSEConnection(url: string | null): UseSSEConnectionResult {
    const [data, setData] = useState<FullRecommendationData | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
                setError('配置错误');
                setIsConnected(false);
                scheduleReconnect();
                return;
            }

            currentSource = es;

            es.onopen = () => {

                setIsConnected(true);
                setError(null);
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
                        setData(parsedData.data);
                    }
                } catch (error) {
                    console.error('Failed to parse SSE message:', error);
                }
            };

            es.onerror = (event) => {
                console.error('SSE error:', event);
                setIsConnected(false);
                setError('连接断开');
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

    return {data, isConnected, error};
}
