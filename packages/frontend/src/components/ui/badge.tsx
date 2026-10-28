import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'focus-ring inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        /** The low-emphasis tint, matching the Button variant of the same name. */
        soft: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        /** A panel: edged and filled with the background colour. */
        surface:
          'border-border bg-background text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        destructive:
          'bg-destructive text-white dark:bg-destructive/60 [a&]:hover:bg-destructive/90',
        outline:
          'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
      },
      size: {
        // 20 / 24 / 28px of text.
        '1': 'px-1.5 py-0 text-[10px]',
        '2': 'px-2 py-0.5 text-xs',
        '3': 'px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: '2',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  size = '2',
  asChild = false,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot='badge'
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge };
