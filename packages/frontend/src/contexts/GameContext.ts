import { createContext } from 'react';

import type { EngineStatus, RecommendationData } from '@/types';

export interface GameContextType {
  data: RecommendationData | null;
  status: EngineStatus | null;
  isHudActive: boolean;
  /** Asks the main process to show or hide the HUD, mirroring it locally. */
  setHudVisible: (visible: boolean) => void;
}

export const GameContext = createContext<GameContextType | null>(null);
