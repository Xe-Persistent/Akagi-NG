import type { VariantProps } from 'class-variance-authority';
import { Slot as SlotPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

import { buttonVariants } from './button-variants';

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = ({ className, variant, size, asChild = false, ref, ...props }: ButtonProps) => {
  const Comp = asChild ? SlotPrimitive.Slot : 'button';
  return (
    <Comp
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
};

export { Button };
