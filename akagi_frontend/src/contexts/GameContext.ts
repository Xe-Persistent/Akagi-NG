import { createContext } from 'react';

import type { FullRecommendationData, NotificationItem, SSEErrorCode } from '@/types';

export interface GameContextType {
  data: FullRecommendationData | null;
  notifications: NotificationItem[];
  isConnected: boolean;
  error: SSEErrorCode | string | null;
  statusMessage: string | null;
  statusType: 'error' | 'warning' | 'success' | 'info' | null;
}

export const GameContext = createContext<GameContextType | null>(null);
