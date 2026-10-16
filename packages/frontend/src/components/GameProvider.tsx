import { type ReactNode, useMemo, useState } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useEngineToasts } from '@/hooks/useEngineToasts';

export function GameProvider({ children }: { children: ReactNode }) {
  const { data, status, error } = useEngineConnection();
  useEngineToasts(status, error);
  const [isHudActive, setIsHudActive] = useState(window.location.hash === '#/hud');

  const value = useMemo(
    () => ({
      data,
      status,
      error,
      isHudActive,
      setIsHudActive,
    }),
    [data, status, error, isHudActive],
  );

  return <GameContext value={value}>{children}</GameContext>;
}
