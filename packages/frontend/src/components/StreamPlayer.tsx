import { useLayoutEffect, useRef, useState } from 'react';

import { STREAM_PLAYER_HEIGHT, STREAM_PLAYER_WIDTH } from '@/config/constants';
import { useGame } from '@/hooks/useGame';
import { isHudWindow } from '@/lib/routing';
import { cn } from '@/lib/utils';

import { type PlaceholderKind, StreamPlaceholder } from './StreamPlaceholder';
import StreamRecommendation from './StreamRecommendation';

interface StreamPlayerProps {
  className?: string;
}

/**
 * The recommendation board: a fixed 1280×720 stage scaled to whatever the window
 * gives it, so every row keeps its proportions. Everything that is content -- the
 * cards -- lives inside that stage and scales with it; the hint shown when there
 * is no content stays outside it and keeps its own pixel size.
 */
export default function StreamPlayer({ className }: StreamPlayerProps) {
  const { data, isHudActive } = useGame();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const updateScale = () => {
      if (wrapperRef.current) {
        const { width, height } = wrapperRef.current.getBoundingClientRect();
        setScale(Math.min(width / STREAM_PLAYER_WIDTH, height / STREAM_PLAYER_HEIGHT));
      }
    };

    // Measured once before observing, so the first paint is already the right
    // size instead of jumping when the observer's first callback arrives.
    updateScale();

    const observer = new ResizeObserver(updateScale);
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const isHudPage = isHudWindow();
  // The HUD window owns the recommendations; the dashboard only says so.
  const placeholder: PlaceholderKind | null =
    isHudActive && !isHudPage ? 'hudActive' : data ? null : 'standby';
  // The HUD window is a transparent overlay: it stays empty until a row arrives.
  const showsPlaceholder = placeholder !== null && !(isHudPage && !data);

  return (
    <div
      ref={wrapperRef}
      className={cn('flex min-h-0 w-full flex-1 items-center justify-center', className)}
    >
      <div
        style={{
          width: STREAM_PLAYER_WIDTH * scale,
          height: STREAM_PLAYER_HEIGHT * scale,
        }}
        className={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-5 border border-white/20 bg-white/10 shadow-lg dark:border-white/5 dark:bg-black/20',
          isHudPage && 'shadow-none',
        )}
      >
        {showsPlaceholder && placeholder && <StreamPlaceholder kind={placeholder} />}

        {!showsPlaceholder && data && (
          <div
            style={{
              transform: `scale(${scale})`,
              width: STREAM_PLAYER_WIDTH,
              height: STREAM_PLAYER_HEIGHT,
              transformOrigin: 'center center',
            }}
            className='flex shrink-0 flex-col items-center justify-center gap-4 p-4'
          >
            {data.recommendations.map((rec, index) => {
              // The same tile can be recommended twice; the position tells them apart.
              const key = `${rec.action}-${rec.tile ?? ''}-${rec.consumed?.join(',') ?? ''}-${index}`;
              return <StreamRecommendation key={key} {...rec} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
