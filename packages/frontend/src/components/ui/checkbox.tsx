import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

const Checkbox = ({ className, ref, ...props }: CheckboxProps) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot='checkbox'
    className={cn(
      'peer border-primary ring-offset-background focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground h-4 w-4 rounded-sm border focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator data-slot='checkbox-indicator' className={cn('text-current')}>
      <Check className='h-4 w-4' />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);

export { Checkbox };
