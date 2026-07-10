import { use } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { cn } from '@/lib/utils';

// 样式常量
const DOT_BASE_CLASS =
  'absolute top-2 left-2 z-indicator h-2.5 w-2.5 rounded-full shadow-sm transition-colors duration-500';

const STATUS_VARIANTS = {
  hidden: 'hidden',
  disconnected: 'animate-pulse bg-rose-500 shadow-rose-500/50',
  circuitOpen: 'animate-pulse bg-red-500 shadow-red-500/50',
  fallback: 'bg-yellow-500 shadow-yellow-500/50',
  online: 'bg-emerald-500 shadow-emerald-500/50',
  local: 'bg-blue-500 shadow-blue-500/50',
  nullEngine: 'bg-zinc-500 shadow-zinc-500/50',
} as const;

type StatusType = keyof typeof STATUS_VARIANTS;

interface ModelStatusIndicatorProps {
  isConnected?: boolean;
  className?: string;
}

export function ModelStatusIndicator({ isConnected, className }: ModelStatusIndicatorProps) {
  const context = use(GameContext);
  const data = context?.data;

  // 优先使用传入的 isConnected，否则退回到上下文
  // 当上下文缺失时，默认视为断开连接
  const connected = isConnected ?? context?.isConnected ?? false;

  const currentStatus: StatusType = (() => {
    // 0. 断开连接（最高优先级）
    if (!connected) return 'disconnected';

    if (!data) return 'hidden';

    // 1. 严重：熔断开启
    if (data.circuit_open) return 'circuitOpen';

    // 2. 警告：降级
    if (data.fallback_used) return 'fallback';

    // 3. 正常：在线/本地/空引擎
    if (data.engine_type === 'null') return 'nullEngine';
    return data.engine_type === 'akagiapi' || data.engine_type === 'akagiot' ? 'online' : 'local';
  })();

  if (currentStatus === 'hidden') return null;

  return <div className={cn(DOT_BASE_CLASS, STATUS_VARIANTS[currentStatus], className)} />;
}
