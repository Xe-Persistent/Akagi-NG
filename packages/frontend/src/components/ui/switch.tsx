import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Track sizes; the thumb and its travel are derived from these widths. */
const TRACK_SIZES = {
  '1': 'h-4 w-7',
  '2': 'h-5 w-9',
  '3': 'h-6 w-11',
} as const;

/**
 * Each thumb fills its track once the 2px border is subtracted, so the checked
 * travel is the remaining gap: 28-4-12, 36-4-16 and 44-4-20.
 */
const THUMB_SIZES = {
  '1': 'h-3 w-3 data-[state=checked]:translate-x-3',
  '2': 'h-4 w-4 data-[state=checked]:translate-x-4',
  '3': 'h-5 w-5 data-[state=checked]:translate-x-5',
} as const;

type SwitchSize = keyof typeof TRACK_SIZES;

type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'size'> & {
  size?: SwitchSize;
};

/**
 * An on/off switch. Sliding rather than clicking through two labels keeps a
 * single boolean setting reading as one setting, which is what the settings page
 * needs for "use the cloud model".
 */
const Switch = ({ className, size = '2', ...props }: SwitchProps) => (
  <SwitchPrimitive.Root
    data-slot='switch'
    data-size={size}
    className={cn(
      'peer focus-ring inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      TRACK_SIZES[size],
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-slot='switch-thumb'
      className={cn(
        'pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0',
        THUMB_SIZES[size],
      )}
    />
  </SwitchPrimitive.Root>
);

export { Switch };
