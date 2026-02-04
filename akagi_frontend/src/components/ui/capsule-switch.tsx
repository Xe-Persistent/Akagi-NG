import { memo, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CapsuleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  labelOn?: ReactNode;
  labelOff?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export const CapsuleSwitch = memo(
  ({
    checked,
    onCheckedChange,
    labelOn = 'On',
    labelOff = 'Off',
    className,
    disabled = false,
  }: CapsuleSwitchProps) => {
    return (
      <div
        className={cn(
          'group bg-muted border-input ring-offset-background focus-within:ring-ring relative inline-grid h-9 min-w-40 grid-cols-2 rounded-full border p-1 font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <div
          className={cn(
            'bg-background ease-premium absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-sm transition-all duration-500',
            checked ? 'translate-x-full' : 'translate-x-0',
          )}
        />
        <button
          type='button'
          role='switch'
          aria-checked={!checked}
          disabled={disabled}
          onClick={() => onCheckedChange(false)}
          className={cn(
            'relative z-10 flex min-w-12 flex-1 items-center justify-center rounded-full px-3 text-sm leading-none whitespace-nowrap transition-colors focus-visible:outline-none',
            !checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labelOff}
        </button>
        <button
          type='button'
          role='switch'
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onCheckedChange(true)}
          className={cn(
            'relative z-10 flex min-w-12 flex-1 items-center justify-center rounded-full px-3 text-sm leading-none whitespace-nowrap transition-colors focus-visible:outline-none',
            checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labelOn}
        </button>
      </div>
    );
  },
);

CapsuleSwitch.displayName = 'CapsuleSwitch';
