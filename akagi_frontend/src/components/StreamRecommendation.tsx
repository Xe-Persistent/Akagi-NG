import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

import { MahjongTile } from '@/components/mahjong/mahjong-tile';
import { ConfidenceRing } from '@/components/mahjong/confidence-ring';
import { ConsumedDisplay } from '@/components/mahjong/consumed-display';

// --- Types & Constants ---

interface RecommendationProps {
  action: string;
  confidence: number;
  consumed?: string[];
  sim_candidates?: { tile: string; confidence: number }[];
  tile?: string;
}

interface ActionConfigItem {
  label: string;
  color: string;
  gradient: string; // Used for background glow and text gradient
}

const ACTION_CONFIG: Record<string, ActionConfigItem> = {
  reach: {
    label: 'actions.reach',
    color: 'var(--color-action-reach)',
    gradient: 'from-orange-500 to-red-500',
  },
  chi: {
    label: 'actions.chi',
    color: 'var(--color-action-chi)',
    gradient: 'from-emerald-400 to-green-600',
  },
  pon: {
    label: 'actions.pon',
    color: 'var(--color-action-pon)',
    gradient: 'from-blue-400 to-indigo-600',
  },
  kan_select: {
    label: 'actions.kan_select',
    color: 'var(--color-action-kan)',
    gradient: 'from-purple-400 to-fuchsia-600',
  },
  hora: {
    label: 'actions.hora',
    color: 'var(--color-action-ron)',
    gradient: 'from-red-500 to-rose-700',
  },
  tsumo: {
    label: 'actions.tsumo',
    color: 'var(--color-action-tsumo)',
    gradient: 'from-red-600 to-rose-900',
  },
  ryukyoku: {
    label: 'actions.ryukyoku',
    color: 'var(--color-action-draw)',
    gradient: 'from-slate-400 to-slate-600',
  },
  nukidora: {
    label: 'actions.nukidora',
    color: 'var(--color-action-kita)',
    gradient: 'from-pink-400 to-rose-500',
  },
  none: {
    label: 'actions.none',
    color: 'var(--color-action-skip)',
    gradient: 'from-gray-400 to-gray-600',
  },
  discard: {
    label: 'actions.discard',
    color: 'var(--color-action-discard)',
    gradient: 'from-zinc-500 to-zinc-700',
  },
};

const SHOW_CONSUMED_ACTIONS = new Set(['chi', 'pon', 'kan_select']);

// --- Main Component ---

const Recommendation: FC<RecommendationProps> = ({
  action,
  confidence,
  consumed,
  sim_candidates,
  tile,
}) => {
  const { t } = useTranslation();
  const config = ACTION_CONFIG[action];
  const hasSimCandidates = sim_candidates && sim_candidates.length > 0;

  // Determine configuration:
  // 1. If strict match (reach, pon etc), use it.
  // 2. Default to discard style.
  const effectiveConfig = config || ACTION_CONFIG['discard'];

  const displayLabel = t(effectiveConfig.label);
  const labelLength = displayLabel.length;

  // Dynamic font size and tracking based on label length
  // 1-2 chars (CN/JP): 6xl, widest
  // 3-4 chars (Short EN/JP): 5xl, wider
  // 5+ chars (Long EN): 4xl, tight
  const fontSizeClass = labelLength <= 2 ? 'text-6xl' : labelLength <= 4 ? 'text-5xl' : 'text-4xl';
  const trackingClass =
    labelLength <= 2 ? 'tracking-widest' : labelLength <= 4 ? 'tracking-wider' : 'tracking-tight';

  // Determine main tile to display
  // If sim_candidates (Riichi Lookahead), main tile is not single.
  // If config exists (pon/chi/hora), usually handled by ConsumedDisplay.
  // Exceptions: 'tsumo' and 'hora' (Ron) might need to show the winning tile.
  let mainTile: string | null = null;
  if (!hasSimCandidates) {
    if ((action === 'tsumo' || action === 'hora') && tile) {
      mainTile = tile;
    } else if (!config) {
      mainTile = action; // It's a discard action (action string is the tile code)
    }
  }

  const shouldShowConsumed = consumed && SHOW_CONSUMED_ACTIONS.has(action);

  return (
    <div className='group relative mx-auto w-full'>
      {/* 1. Background Glow Effect */}
      <div className={cn('background-glow', effectiveConfig.gradient)} />

      {/* 2. Main Container (Glassmorphism) */}
      <div className='glass-card'>
        {/* Decoration: Left Strip */}
        <div
          className={cn(
            'absolute top-0 bottom-0 left-0 w-2',
            `bg-linear-to-b ${effectiveConfig.gradient}`,
          )}
        />

        {/* Left: Action Label */}
        <div className='z-10 mr-2 flex h-full w-52 flex-col items-center justify-center'>
          <h2
            className={cn(
              'action-text-gradient text-center',
              fontSizeClass,
              trackingClass,
              effectiveConfig.gradient,
            )}
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.1)' }}
          >
            {displayLabel}
          </h2>
        </div>

        {/* Separator */}
        <div className='mr-10 h-24 w-px bg-zinc-200 dark:bg-zinc-700' />

        {/* Center: Tile Display Area */}
        <div className='flex h-full grow items-center justify-start gap-8 overflow-x-auto overflow-y-hidden px-2'>
          {/* Case A: Riichi Declaration Candidates */}
          {hasSimCandidates ? (
            <div className='flex gap-8'>
              {sim_candidates.map((cand, idx) => (
                <div key={idx} className='flex flex-row items-end gap-4'>
                  {/* Tile */}
                  <MahjongTile tile={cand.tile} className='scale-110 shadow-md' />
                  {/* Show confidence for each candidate (only if > 1) */}
                  {sim_candidates.length > 1 && (
                    <div className='mb-1'>
                      <ConfidenceRing
                        percentage={cand.confidence}
                        color={effectiveConfig.color}
                        size={64}
                        stroke={6}
                        fontSize='text-2xl'
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Case B: Single Tile Display (Tsumo / Discard) */}
              {mainTile && (
                <div className='flex items-center gap-5'>
                  <MahjongTile tile={mainTile} className='scale-110' />
                </div>
              )}

              {/* Case C: Called Combinations (Chi, Pon, Kan) */}
              {shouldShowConsumed && consumed && (
                <ConsumedDisplay action={action} consumed={consumed} tile={tile} />
              )}
            </>
          )}
        </div>

        {/* Right: Confidence */}
        <div className='ml-6 flex flex-col items-center justify-center'>
          <ConfidenceRing percentage={confidence} color={effectiveConfig.color} />
        </div>
      </div>
    </div>
  );
};

export default Recommendation;
