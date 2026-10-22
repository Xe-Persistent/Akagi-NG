import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>;

/**
 * An on/off switch. Sliding rather than clicking through two labels keeps a
 * single boolean setting reading as one setting, which is what the settings page
 * needs for "use the cloud model".
 */
const Switch = ({ className, ...props }: SwitchProps) => (
  <SwitchPrimitive.Root
    data-slot='switch'
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-slot='switch-thumb'
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
);

export { Switch };
