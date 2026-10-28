import { ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CapsuleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  labelOn: ReactNode;
  labelOff: ReactNode;
  /** Names the choice: a radio group must say what it chooses between. */
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

const ON = 'on';
const OFF = 'off';

/** The item text follows the choice, matching the pill behind it. */
function itemClassName(isActive: boolean) {
  return cn(
    'focus-ring relative z-content flex min-w-12 items-center justify-center rounded-full px-3 text-sm leading-none whitespace-nowrap transition-colors',
    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
  );
}

/**
 * A two-option mode selector.
 *
 * Radix's single-select `ToggleGroup` rather than two switches: the two labels
 * are one choice, not two independent settings. Radix renders that group as a
 * `radiogroup` with a checked radio per option, which is the semantics — and the
 * roving focus — a pair of hand-written buttons would have to reimplement.
 */
export function CapsuleSwitch({
  checked,
  onCheckedChange,
  labelOn,
  labelOff,
  ariaLabel,
  className,
  disabled = false,
}: CapsuleSwitchProps) {
  return (
    <ToggleGroup.Root
      type='single'
      value={checked ? ON : OFF}
      // Pressing the active item clears the group, and the mode has no empty
      // state: an empty value is ignored so the choice stays where it was.
      onValueChange={(value) => {
        if (value) onCheckedChange(value === ON);
      }}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'group relative inline-grid h-9 min-w-40 grid-cols-2 rounded-full border border-input bg-muted p-1 font-medium ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {/* The pill is decoration; the selected state lives on the radios. */}
      <div
        aria-hidden='true'
        className={cn(
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-sm transition-transform duration-500 ease-premium',
          checked ? 'translate-x-full' : 'translate-x-0',
        )}
      />

      <ToggleGroup.Item value={OFF} className={itemClassName(!checked)}>
        {labelOff}
      </ToggleGroup.Item>
      <ToggleGroup.Item value={ON} className={itemClassName(checked)}>
        {labelOn}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
