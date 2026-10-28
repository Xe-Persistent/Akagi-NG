import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'size'> {
  /** Same steps as `Button`; the button is square at every one of them. */
  size?: '1' | '2' | '3' | '4';
  /**
   * Required: the control renders only an icon, so this is the only name
   * assistive tech has for it.
   */
  'aria-label': string;
}

/**
 * A button that holds a single icon and nothing else.
 *
 * The square shape comes from `aspect-square` over `Button`'s height, so the
 * two stay in step as the size scale changes; `px-0` replaces the text padding
 * the size step would otherwise add.
 */
export function IconButton({ size = '3', className, ...props }: IconButtonProps) {
  return <Button size={size} className={cn('aspect-square px-0', className)} {...props} />;
}
