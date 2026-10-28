import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export interface NavbarActionButtonProps extends Omit<ComponentProps<typeof IconButton>, 'size'> {
  icon: LucideIcon;
  iconClassName?: string;
}

/** One icon on the title bar: ghost, square, and the size the header uses. */
export function NavbarActionButton({
  icon: Icon,
  className,
  iconClassName,
  ...props
}: NavbarActionButtonProps) {
  return (
    <IconButton
      variant='ghost'
      className={cn(
        'no-drag relative text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      {...props}
    >
      <Icon className={cn('h-4 w-4', iconClassName)} aria-hidden='true' />
    </IconButton>
  );
}
