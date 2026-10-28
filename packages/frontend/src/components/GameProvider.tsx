import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { toggleHud } from '@/api/desktop';
import { onHudVisibilityChanged } from '@/api/events';
import { GameContext } from '@/contexts/GameContext';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useEngineToasts } from '@/hooks/useEngineToasts';
import { isHudWindow } from '@/lib/routing';

export function GameProvider({ children }: { children: ReactNode }) {
  const { data, status } = useEngineConnection();
  useEngineToasts(status);
  const [isHudActive, setIsHudActive] = useState(() => isHudWindow());

  // The HUD can also be closed from its own window, so its visibility follows
  // what the main process reports rather than only the dashboard's click.
  useEffect(() => onHudVisibilityChanged(setIsHudActive), []);

  const setHudVisible = useCallback((visible: boolean) => {
    void toggleHud(visible);
    setIsHudActive(visible);
  }, []);

  const value = useMemo(
    () => ({ data, status, isHudActive, setHudVisible }),
    [data, status, isHudActive, setHudVisible],
  );

  return <GameContext value={value}>{children}</GameContext>;
}
