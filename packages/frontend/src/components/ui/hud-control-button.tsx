import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function HudControlButton({ className, ref, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      ref={ref}
      variant='ghost'
      size='icon'
      className={cn(
        'no-drag z-hud h-6 w-6 rounded-full text-white dark:text-zinc-200',
        'opacity-40 transition duration-300',
        'hover:bg-white/20 hover:opacity-100 dark:hover:bg-zinc-800/50',
        className,
      )}
      {...props}
    />
  );
}
