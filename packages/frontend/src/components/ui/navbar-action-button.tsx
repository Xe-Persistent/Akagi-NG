import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NavbarActionButtonProps extends ComponentProps<typeof Button> {
  icon: LucideIcon;
  iconClassName?: string;
}

export function NavbarActionButton({
  icon: Icon,
  className,
  iconClassName,
  ref,
  ...props
}: NavbarActionButtonProps) {
  return (
    <Button
      ref={ref}
      variant='ghost'
      size='icon'
      className={cn(
        'no-drag relative aspect-square text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      {...props}
    >
      <Icon className={cn('h-4 w-4', iconClassName)} />
    </Button>
  );
}
