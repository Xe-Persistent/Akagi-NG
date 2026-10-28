import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const inputVariants = cva(
  'focus-ring flex w-full rounded-2 border border-input bg-transparent shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        // 28 / 32 / 36px.
        '1': 'h-7 px-2 py-0.5 text-xs',
        '2': 'h-8 px-2.5 py-1 text-xs',
        '3': 'h-9 px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      size: '3',
    },
  },
);

/** The default field, for `PasswordInput`, which renders its own `input`. */
export const inputClassName = inputVariants({ size: '3' });

type InputProps = Omit<ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>;

const Input = ({ className, type, size = '3', ref, ...props }: InputProps) => {
  return (
    <input
      type={type}
      data-slot='input'
      data-size={size}
      spellCheck={false}
      autoComplete='off'
      className={cn(inputVariants({ size }), className)}
      ref={ref}
      {...props}
    />
  );
};

export { Input };
