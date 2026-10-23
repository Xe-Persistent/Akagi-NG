import { type ReactNode, useMemo, useState } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useEngineToasts } from '@/hooks/useEngineToasts';
import { isHudWindow } from '@/lib/routing';

export function GameProvider({ children }: { children: ReactNode }) {
  const { data, status } = useEngineConnection();
  // The HUD renders the recommendations only; it has no toast container.
  const isHud = isHudWindow();
  useEngineToasts(status, !isHud);
  const [isHudActive, setIsHudActive] = useState(isHud);

  const value = useMemo(
    () => ({ data, status, isHudActive, setIsHudActive }),
    [data, status, isHudActive],
  );

  return <GameContext value={value}>{children}</GameContext>;
}
