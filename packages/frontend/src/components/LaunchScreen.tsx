import type { CSSProperties } from 'react';

import { APP_SPLASH_ENTER_MS, APP_SPLASH_EXIT_MS } from '@/config/constants';
import { cn } from '@/lib/utils';

/** The two lines share one entrance; only the delay and the type differ. */
const LINE_ENTER = 'animate-in fade-in-0 slide-in-from-bottom-4 fill-mode-backwards';

/** The two text lines follow the torii, far enough behind to read as a second beat. */
const TEXT_START_MS = APP_SPLASH_ENTER_MS / 2;
const TEXT_STAGGER_MS = 150;

/**
 * Everything that enters does so over the same window: a later start simply
 * moves faster, so the logo and both lines land together.
 */
const enterTiming = (delayMs: number): CSSProperties => ({
  animationDuration: `${APP_SPLASH_ENTER_MS - delayMs}ms`,
  animationDelay: `${delayMs}ms`,
});

export interface LaunchScreenProps {
  /** Plays the fade-out; the caller unmounts the screen once it has finished. */
  exiting?: boolean;
}

export function LaunchScreen({ exiting = false }: LaunchScreenProps) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 z-splash flex flex-col items-center justify-center gap-8 p-8',
        exiting && 'animate-out fade-out-0 fill-mode-forwards zoom-out-95',
      )}
      style={exiting ? { animationDuration: `${APP_SPLASH_EXIT_MS}ms` } : undefined}
    >
      {/* The glow grows with the torii, so the two read as one object. */}
      <div className='relative animate-in fade-in-0 zoom-in-50' style={enterTiming(0)}>
        <div className='logo-glow-effect' />
        <img src='torii.svg' alt='Akagi Logo' className='relative h-32 w-32 drop-shadow-lg' />
      </div>

      <div className='flex flex-col items-center gap-3'>
        <h1
          className={cn(LINE_ENTER, 'text-4xl font-bold tracking-tight')}
          style={enterTiming(TEXT_START_MS)}
        >
          Akagi <span className='text-rose-500'>NG</span>
        </h1>
        <p
          className={cn(
            LINE_ENTER,
            'text-sm font-medium tracking-wide text-muted-foreground uppercase',
          )}
          style={enterTiming(TEXT_START_MS + TEXT_STAGGER_MS)}
        >
          Next Generation Mahjong AI
        </p>
      </div>
    </div>
  );
}
