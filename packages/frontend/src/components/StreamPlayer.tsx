import { Monitor } from 'lucide-react';
import { use, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { STREAM_PLAYER_HEIGHT, STREAM_PLAYER_WIDTH } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { cn } from '@/lib/utils';

import StreamRenderComponent from './StreamRenderComponent';

interface StreamPlayerProps {
  className?: string;
}

/**
 * HUD 激活时的覆盖层组件
 */
function HudOverlay() {
  const { t } = useTranslation();
  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center'>
      <div className='flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-pink-500/20 to-violet-500/20 dark:from-pink-500/10 dark:to-violet-500/10'>
        <Monitor className='h-10 w-10 text-pink-500 dark:text-pink-400' />
      </div>
      <div className='space-y-2'>
        <h3 className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>
          {t('app.hud_active')}
        </h3>
        <p className='text-sm text-zinc-500 dark:text-zinc-400'>{t('app.hud_desc')}</p>
      </div>
    </div>
  );
}

/**
 * 视频流播放器组件
 */
export default function StreamPlayer({ className }: StreamPlayerProps) {
  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');
  const { data, isHudActive } = context;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const containerSize = {
    width: STREAM_PLAYER_WIDTH * scale,
    height: STREAM_PLAYER_HEIGHT * scale,
  };

  useLayoutEffect(() => {
    const updateScale = () => {
      if (wrapperRef.current) {
        const { width, height } = wrapperRef.current.getBoundingClientRect();
        setScale(Math.min(width / STREAM_PLAYER_WIDTH, height / STREAM_PLAYER_HEIGHT));
      }
    };

    const observer = new ResizeObserver(updateScale);
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const isHudPage = window.location.hash === '#/hud';

  return (
    <div
      ref={wrapperRef}
      className={cn('flex min-h-0 w-full flex-1 items-center justify-center', className)}
    >
      <div
        ref={containerRef}
        style={{
          width: containerSize.width,
          height: containerSize.height,
        }}
        className={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-lg dark:border-white/5 dark:bg-black/20',
          isHudPage && 'shadow-none',
        )}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            width: STREAM_PLAYER_WIDTH,
            height: STREAM_PLAYER_HEIGHT,
            transformOrigin: 'center center',
          }}
          className='shrink-0'
        >
          {isHudActive && !isHudPage ? <HudOverlay /> : <StreamRenderComponent data={data} />}
        </div>
      </div>
    </div>
  );
}
