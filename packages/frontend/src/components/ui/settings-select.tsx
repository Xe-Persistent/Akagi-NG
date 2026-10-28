import type { ReactNode } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SettingsSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface SettingsSelectProps {
  value: string;
  options: readonly SettingsSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
}

/**
 * A settings dropdown with the four Radix parts already assembled.
 *
 * A stored value the current list no longer offers is added ahead of the options:
 * a model file can be renamed on disk, and the select must keep showing what is
 * stored instead of an empty trigger.
 */
export function SettingsSelect({
  value,
  options,
  onValueChange,
  placeholder,
}: SettingsSelectProps) {
  const storedIsMissing = value !== '' && !options.some((option) => option.value === value);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {storedIsMissing && <SelectItem value={value}>{value}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
