import { use } from 'react';

import { GameContext } from '@/contexts/GameContext';
import { cn } from '@/lib/utils';
import type { EngineStatus, RecommendationData } from '@/types';

const DOT_BASE_CLASS =
  'absolute top-2 left-2 z-indicator h-2.5 w-2.5 rounded-full shadow-sm transition-colors duration-500';

const STATUS_VARIANTS = {
  hidden: 'hidden',
  failed: 'bg-rose-600 shadow-rose-600/50',
  circuitOpen: 'animate-pulse bg-rose-500 shadow-rose-500/50',
  fallback: 'bg-yellow-400 shadow-yellow-400/50',
  online: 'bg-emerald-500 shadow-emerald-500/50',
  local: 'bg-blue-500 shadow-blue-500/50',
} as const;

type StatusType = keyof typeof STATUS_VARIANTS;

interface ModelStatusIndicatorProps {
  className?: string;
}

/**
 * Which colour the dot should show, in the order that matters: a failed model
 * outranks anything a recommendation says, and without a recommendation there is
 * no model to describe yet.
 *
 * A model that is still loading is not a colour here: loading is progress, not
 * an answer, and it is already announced by the "model loaded" toast. Until a row
 * exists the dot stays hidden, so amber no longer competes with the four states
 * that say who answered the hand on screen.
 */
export function resolveIndicatorStatus(
  status: EngineStatus | null | undefined,
  data: RecommendationData | null | undefined,
): StatusType {
  if (!status || status.connection === 'idle') return 'hidden';
  if (status.model === 'failed') return 'failed';
  if (!data) return 'hidden';
  if (data.circuit_open) return 'circuitOpen';
  if (data.fallback_used) return 'fallback';
  if (data.engine_type === 'mjot') return 'online';
  return 'local';
}

/**
 * One dot for the state of the model answering right now: green when the online
 * service did, flashing red while its breaker is open, yellow when it failed and
 * the local model covered for it, blue for local.
 *
 * Nothing is shown unless a game is connected and a recommendation exists: with
 * no rows on screen a colour would claim a model that has not answered yet.
 */
export function ModelStatusIndicator({ className }: ModelStatusIndicatorProps) {
  const context = use(GameContext);
  const currentStatus = resolveIndicatorStatus(context?.status, context?.data);

  if (currentStatus === 'hidden') return null;

  return <div className={cn(DOT_BASE_CLASS, STATUS_VARIANTS[currentStatus], className)} />;
}
