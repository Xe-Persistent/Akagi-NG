import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NavbarActionButtonProps extends ComponentProps<typeof Button> {
  icon: LucideIcon;
  iconClassName?: string;
  badge?: boolean;
}

export const NavbarActionButton = ({
  icon: Icon,
  className,
  iconClassName,
  badge,
  ref,
  ...props
}: NavbarActionButtonProps) => {
  return (
    <Button
      ref={ref}
      variant='ghost'
      size='icon'
      className={cn(
        'no-drag text-muted-foreground hover:bg-accent hover:text-foreground relative aspect-square transition-colors',
        className,
      )}
      {...props}
    >
      <Icon className={cn('h-4 w-4', iconClassName)} />
      {badge && (
        <span className='absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50' />
      )}
    </Button>
  );
};

NavbarActionButton.displayName = 'NavbarActionButton';
