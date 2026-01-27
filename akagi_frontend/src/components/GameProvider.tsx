import { type ReactNode } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { useSSEConnection } from '@/hooks/useSSEConnection';
import { useStatusNotification } from '@/hooks/useStatusNotification';

export function GameProvider({ children }: { children: ReactNode }) {
  const { backendUrl } = useConnectionConfig();
  const { data, notifications, isConnected, error } = useSSEConnection(backendUrl);
  const { statusMessage, statusType } = useStatusNotification(notifications, error);

  return (
    <GameContext.Provider
      value={{
        data,
        notifications,
        isConnected,
        error,
        statusMessage,
        statusType,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
