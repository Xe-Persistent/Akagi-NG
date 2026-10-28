import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandMark } from '@/components/BrandMark';
import type { ExitAnimationTiming } from '@/types';

interface ExitOverlayProps {
  timing: ExitAnimationTiming;
  /** Called once the fade-in and the hold are both over. */
  onComplete: () => void;
}

export function ExitOverlay({ timing, onComplete }: ExitOverlayProps) {
  const { t } = useTranslation();
  const notifyComplete = useEffectEvent(onComplete);

  useEffect(() => {
    const timer = setTimeout(notifyComplete, timing.fadeMs + timing.holdMs);
    return () => clearTimeout(timer);
  }, [timing.fadeMs, timing.holdMs]);

  return (
    <div
      // Reduced motion is handled once in `index.css`: it collapses every
      // animation's duration, so no per-component opt-out is needed here.
      className='fixed inset-0 z-exit flex flex-col items-center justify-center bg-white/30 backdrop-blur-xl animate-in fade-in-0 dark:bg-zinc-950/30'
      style={{ animationDuration: `${timing.fadeMs}ms` }}
    >
      <BrandMark className='mb-8' />
      <h1 className='mb-4 text-4xl font-bold tracking-tight text-rose-500'>
        {t('app.stopped_title')}
      </h1>
      <p className='text-lg font-medium text-muted-foreground'>{t('app.stopped_desc')}</p>
    </div>
  );
}
