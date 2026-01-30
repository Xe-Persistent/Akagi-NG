import { Monitor } from 'lucide-react';
import { type FC, use, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PIP_WINDOW_HEIGHT, PIP_WINDOW_WIDTH } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { cn } from '@/lib/utils';
import type { StreamPlayerProps } from '@/types';

import StreamRenderComponent from './StreamRenderComponent.tsx';

const StreamPlayer: FC<StreamPlayerProps> = ({ className }) => {
  const { t } = useTranslation();
  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');
  const { data, isHudActive } = context;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [containerSize, setContainerSize] = useState({
    width: PIP_WINDOW_WIDTH,
    height: PIP_WINDOW_HEIGHT,
  });

  useLayoutEffect(() => {
    const updateScale = () => {
      if (wrapperRef.current) {
        const { width, height } = wrapperRef.current.getBoundingClientRect();
        const scaleW = width / PIP_WINDOW_WIDTH;
        const scaleH = height / PIP_WINDOW_HEIGHT;
        const newScale = Math.min(scaleW, scaleH);

        setScale(newScale);
        setContainerSize({
          width: PIP_WINDOW_WIDTH * newScale,
          height: PIP_WINDOW_HEIGHT * newScale,
        });
      }
    };

    updateScale();
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
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-6',
        className,
      )}
    >
      <div
        ref={containerRef}
        style={{
          width: containerSize.width,
          height: containerSize.height,
        }}
        className={cn(
          'stream-player-container flex shrink-0 items-center justify-center',
          isHudPage && 'shadow-none',
        )}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            width: PIP_WINDOW_WIDTH,
            height: PIP_WINDOW_HEIGHT,
            transformOrigin: 'center center',
          }}
          className='shrink-0 transition-transform duration-100 ease-linear'
        >
          {isHudActive && !isHudPage ? (
            <div className='stream-player-overlay'>
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
          ) : (
            <StreamRenderComponent data={data} />
          )}
        </div>
      </div>
    </div>
  );
};

export default StreamPlayer;
