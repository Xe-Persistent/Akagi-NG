import { type ReactNode, useMemo, useState } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useEngineToasts } from '@/hooks/useEngineToasts';
import { isHudWindow } from '@/lib/routing';

export function GameProvider({ children }: { children: ReactNode }) {
  const { data, status, error } = useEngineConnection();
  useEngineToasts(status, error);
  const [isHudActive, setIsHudActive] = useState(() => isHudWindow());

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
