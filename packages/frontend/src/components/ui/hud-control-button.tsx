import type { ComponentProps } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

/** The small controls that float over the HUD's recommendation board. */
export function HudControlButton({ className, ...props }: ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      variant='ghost'
      size='1'
      className={cn(
        'no-drag z-hud rounded-full text-white dark:text-zinc-200',
        'opacity-40 transition duration-300',
        'hover:bg-white/20 hover:opacity-100 dark:hover:bg-zinc-800/50',
        className,
      )}
      {...props}
    />
  );
}
