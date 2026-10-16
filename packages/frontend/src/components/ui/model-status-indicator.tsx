import { use } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { cn } from '@/lib/utils';

// 样式常量
const DOT_BASE_CLASS =
  'absolute top-2 left-2 z-indicator h-2.5 w-2.5 rounded-full shadow-sm transition-colors duration-500';

const STATUS_VARIANTS = {
  hidden: 'hidden',
  disconnected: 'animate-pulse bg-rose-500 shadow-rose-500/50',
  loading: 'animate-pulse bg-amber-500 shadow-amber-500/50',
  failed: 'bg-rose-600 shadow-rose-600/50',
  ready: 'bg-blue-500 shadow-blue-500/50',
} as const;

type StatusType = keyof typeof STATUS_VARIANTS;

interface ModelStatusIndicatorProps {
  className?: string;
}

export function ModelStatusIndicator({ className }: ModelStatusIndicatorProps) {
  const context = use(GameContext);
  const status = context?.status;

  const currentStatus: StatusType = (() => {
    if (!status || status.connection === 'idle') return 'disconnected';
    if (status.model === 'failed') return 'failed';
    if (status.model === 'loading') return 'loading';
    if (status.model !== 'ready') return 'hidden';
    return 'ready';
  })();

  if (currentStatus === 'hidden') return null;

  return <div className={cn(DOT_BASE_CLASS, STATUS_VARIANTS[currentStatus], className)} />;
}
