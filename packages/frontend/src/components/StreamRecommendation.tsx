import { useTranslation } from 'react-i18next';

import { ConfidenceRing } from '@/components/mahjong/confidence-ring';
import { ConsumedDisplay } from '@/components/mahjong/consumed-display';
import { MahjongTile } from '@/components/mahjong/mahjong-tile';
import { ACTION_CONFIG, SHOW_CONSUMED_ACTIONS } from '@/config/actionConfig';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/types';

export default function StreamRecommendation({
  action,
  confidence,
  consumed,
  sim_candidates,
  tile,
}: Recommendation) {
  const { t } = useTranslation();
  const config = ACTION_CONFIG[action];
  const hasSimCandidates = sim_candidates && sim_candidates.length > 0;

  // Anything without a config of its own is a plain discard.
  const effectiveConfig = config ?? ACTION_CONFIG.discard;

  const displayLabel = t(effectiveConfig.label);
  const labelLength = displayLabel.length;

  const fontSizeClass = labelLength <= 2 ? 'text-6xl' : labelLength <= 4 ? 'text-5xl' : 'text-4xl';
  const trackingClass =
    labelLength <= 2 ? 'tracking-widest' : labelLength <= 4 ? 'tracking-wider' : 'tracking-tight';

  let mainTile: string | null = null;
  if (!hasSimCandidates) {
    if (
      (action === 'tsumo' || action === 'ron' || action === 'nukidora' || action === 'reach') &&
      tile
    ) {
      mainTile = tile;
    } else if (!config) {
      mainTile = action; // A plain discard: the action string is the tile code.
    }
  }

  const shouldShowConsumed = consumed && SHOW_CONSUMED_ACTIONS.has(action);

  return (
    <div
      className={cn(
        'group relative mx-auto w-full',
        'duration-500 ease-premium animate-in fade-in-0 slide-in-from-bottom-4',
      )}
    >
      <div className={cn('background-glow', effectiveConfig.gradient)} />

      <div className='glass-card'>
        <div className={cn('accent-strip', effectiveConfig.gradient)} />

        <div className='z-content mr-2 flex h-full w-52 flex-col items-center justify-center'>
          <h2
            className={cn(
              'action-text-gradient text-center',
              fontSizeClass,
              trackingClass,
              effectiveConfig.gradient,
            )}
          >
            {displayLabel}
          </h2>
        </div>

        <div className='vertical-divider mr-10' />

        <div className='flex h-full grow items-center gap-8 overflow-x-auto overflow-y-hidden px-2'>
          {/* Riichi candidates */}
          {hasSimCandidates ? (
            <div className='flex gap-8'>
              {sim_candidates.map((cand) => (
                <div key={cand.tile} className='flex items-end gap-4'>
                  <MahjongTile tile={cand.tile} className='scale-110 shadow-md' />
                  {/* Per-candidate confidence only means something with a choice to make. */}
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
              {/* A single tile: tsumo, ron, nukidora or the discard. */}
              {mainTile && (
                <div className='flex items-center gap-5'>
                  <MahjongTile tile={mainTile} className='scale-110' />
                </div>
              )}

              {/* The tiles a chi, pon or kan takes. */}
              {shouldShowConsumed && consumed && (
                <ConsumedDisplay action={action} consumed={consumed} tile={tile} />
              )}
            </>
          )}
        </div>

        <div className='ml-6 flex items-center justify-center'>
          <ConfidenceRing percentage={confidence} color={effectiveConfig.color} />
        </div>
      </div>
    </div>
  );
}
