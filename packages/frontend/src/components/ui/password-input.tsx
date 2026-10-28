import { Eye, EyeOff } from 'lucide-react';
import { unstable_PasswordToggleField as PasswordToggleField } from 'radix-ui';
import { useState } from 'react';

import { inputClassName as baseInputClassName } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PasswordInputProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Names the field for assistive tech; the visible label lives in `SettingsItem`. */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A password field with the reveal toggle *inside* the box, so the row keeps a
 * single control on its right.
 *
 * Radix owns the focus, caret and naming: toggling must not drop the caret or
 * let a screen reader lose its place, it keeps `type=password` back after a form
 * reset, and it names the icon-only toggle itself while tying it to the field
 * with `aria-controls`.
 */
export function PasswordInput({
  id,
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  disabled = false,
  className,
}: PasswordInputProps) {
  // Controlled, so the icon can follow the state; the label comes from Radix.
  const [visible, setVisible] = useState(false);

  // Radix narrows `autoComplete` to the two password-manager values, but this is
  // not a login credential: a saved password for the dashboard origin must never
  // be offered here, let alone fill the box with something that is not a key.
  const noAutofill = { autoComplete: 'off' } as unknown as { autoComplete: 'new-password' };

  return (
    <PasswordToggleField.Root visible={visible} onVisibilityChange={setVisible}>
      <div className={cn('relative', className)}>
        <PasswordToggleField.Input
          {...noAutofill}
          id={id}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(baseInputClassName, 'pr-10')}
        />
        <PasswordToggleField.Toggle
          id={id ? `${id}-toggle` : undefined}
          disabled={disabled}
          className='focus-ring absolute inset-y-0 right-1 my-auto flex h-7 w-7 items-center justify-center rounded-2 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
        >
          {visible ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
        </PasswordToggleField.Toggle>
      </div>
    </PasswordToggleField.Root>
  );
}
