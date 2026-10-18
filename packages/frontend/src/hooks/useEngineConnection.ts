import { useEffect, useState } from 'react';

import type { EngineStatus, RecommendationData } from '@/types';

interface UseEngineConnectionResult {
  data: RecommendationData | null;
  status: EngineStatus | null;
}

/**
 * Subscribes to what the main process broadcasts: the engine's status and the
 * recommendations to render. The status is fetched once on mount so a window that
 * opens mid-session does not have to wait for the next change.
 */
export function useEngineConnection(): UseEngineConnectionResult {
  const [data, setData] = useState<RecommendationData | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);

  useEffect(() => {
    const unsubRecommendations = window.electron.on(
      'engine:recommendations',
      (payload: unknown) => {
        setData(payload as RecommendationData);
      },
    );

    const unsubStatus = window.electron.on('engine:status', (payload: unknown) => {
      setStatus(payload as EngineStatus);
    });

    window.electron
      .invoke<EngineStatus>('engine:status:get')
      .then((snapshot) => {
        if (snapshot) setStatus(snapshot);
      })
      .catch(() => {
        // Without a handler the first broadcast still arrives on change.
      });

    return () => {
      unsubRecommendations();
      unsubStatus();
    };
  }, []);

  return { data, status };
}
