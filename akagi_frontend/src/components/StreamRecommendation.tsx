import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfidenceRing } from '@/components/mahjong/confidence-ring';
import { ConsumedDisplay } from '@/components/mahjong/consumed-display';
import { MahjongTile } from '@/components/mahjong/mahjong-tile';
import { ACTION_CONFIG, SHOW_CONSUMED_ACTIONS } from '@/config/actionConfig';
import { cn } from '@/lib/utils';
import type { Recommendation } from '@/types';

const Recommendation: FC<Recommendation> = ({
  action,
  confidence,
  consumed,
  sim_candidates,
  tile,
}) => {
  const { t } = useTranslation();
  const config = ACTION_CONFIG[action];
  const hasSimCandidates = sim_candidates && sim_candidates.length > 0;

  // 确定配置：优先精确匹配（reach、pon 等），否则默认切牌样式
  const effectiveConfig = config || ACTION_CONFIG['discard'];

  const displayLabel = t(effectiveConfig.label);
  const labelLength = displayLabel.length;

  // 根据标签长度动态调整字体大小
  const fontSizeClass = labelLength <= 2 ? 'text-6xl' : labelLength <= 4 ? 'text-5xl' : 'text-4xl';
  const trackingClass =
    labelLength <= 2 ? 'tracking-widest' : labelLength <= 4 ? 'tracking-wider' : 'tracking-tight';

  // 确定要显示的主要牌张
  // 立直前瞻、吃碰杠等有特殊处理
  let mainTile: string | null = null;
  if (!hasSimCandidates) {
    if ((action === 'tsumo' || action === 'ron' || action === 'nukidora') && tile) {
      mainTile = tile;
    } else if (!config) {
      mainTile = action; // 这是一个弃牌动作（动作字符串即为牌代码）
    }
  }

  const shouldShowConsumed = consumed && SHOW_CONSUMED_ACTIONS.has(action);

  return (
    <div
      className={cn(
        'group will-change-transform-opacity relative mx-auto w-full',
        'animate-in fade-in slide-in-from-bottom-4 ease-premium duration-500',
      )}
    >
      {/* 1. Background Glow Effect */}
      <div className={cn('background-glow', effectiveConfig.gradient)} />

      {/* 2. Main Container (Glassmorphism) */}
      <div className='glass-card'>
        {/* Decoration: Left Strip */}
        <div
          className={cn(
            'absolute top-0 bottom-0 left-0 w-2 bg-linear-to-b',
            effectiveConfig.gradient,
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
          >
            {displayLabel}
          </h2>
        </div>

        {/* Separator */}
        <div className='vertical-divider mr-10' />

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

export default memo(Recommendation);
