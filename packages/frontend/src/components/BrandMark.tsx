import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The torii and its glow, which read as one object. Shared by the splash and the
 * stopped screen so the two cannot drift apart; the caller owns the entrance
 * animation, since each screen brings its own.
 */
export function BrandMark({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('relative', className)} {...props}>
      <div className='logo-glow-effect' />
      <img src='torii.svg' alt='Akagi NG' className='relative h-32 w-32 drop-shadow-lg' />
    </div>
  );
}
