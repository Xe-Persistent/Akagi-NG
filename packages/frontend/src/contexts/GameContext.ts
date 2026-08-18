import { createContext } from 'react';

import type { ConnectionErrorCode, FullRecommendationData, NotificationItem } from '@/types';

export interface GameContextType {
  data: FullRecommendationData | null;
  notifications: NotificationItem[];
  isConnected: boolean;
  error: ConnectionErrorCode | string | null;
  statusMessage: string | null;
  statusType: 'error' | 'warning' | 'success' | 'info' | null;
  isHudActive: boolean;
  setIsHudActive: (active: boolean) => void;
}

export const GameContext = createContext<GameContextType | null>(null);
