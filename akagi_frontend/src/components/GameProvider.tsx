import { type ReactNode, useMemo, useState } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { useSSEConnection } from '@/hooks/useSSEConnection';
import { useStatusNotification } from '@/hooks/useStatusNotification';

export function GameProvider({ children }: { children: ReactNode }) {
  const { backendUrl } = useConnectionConfig();
  const { data, notifications, isConnected, error } = useSSEConnection(backendUrl);
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

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
