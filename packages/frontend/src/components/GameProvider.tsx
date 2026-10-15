import { type ReactNode, useMemo, useState } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useStatusNotification } from '@/hooks/useStatusNotification';

export function GameProvider({ children }: { children: ReactNode }) {
  const { isConnected, error, data, notifications } = useEngineConnection();
  const { statusMessage, statusType } = useStatusNotification(notifications, error);
  const [isHudActive, setIsHudActive] = useState(window.location.hash === '#/hud');

  const value = useMemo(
    () => ({
      data,
      notifications,
      isConnected,
      error,
      statusMessage,
      statusType,
      isHudActive,
      setIsHudActive,
    }),
    [data, notifications, isConnected, error, statusMessage, statusType, isHudActive],
  );

  return <GameContext value={value}>{children}</GameContext>;
}
