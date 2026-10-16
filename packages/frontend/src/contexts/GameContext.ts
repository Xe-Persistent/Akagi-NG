import { createContext } from 'react';

import type { EngineStatus, RecommendationData } from '@/types';

export interface GameContextType {
  data: RecommendationData | null;
  status: EngineStatus | null;
  error: string | null;
  isHudActive: boolean;
  setIsHudActive: (active: boolean) => void;
}

export const GameContext = createContext<GameContextType | null>(null);
