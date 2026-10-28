import { Laptop, Moon, Sun } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { Theme } from '@/types';

interface ThemeOption {
  value: Theme;
  icon: typeof Sun;
  /** The label that names the option for assistive tech; the icons have none. */
  labelKey: string;
  /** Tint of the icon while this option is active. */
  activeIconColor: string;
}

/** The option an unknown theme falls back to; also the last one in the list. */
const SYSTEM_OPTION: ThemeOption = {
  value: 'system',
  icon: Laptop,
  labelKey: 'settings.general.theme_system',
  activeIconColor: 'text-zinc-900 dark:text-zinc-100',
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    icon: Sun,
    labelKey: 'settings.general.theme_light',
    activeIconColor: 'text-amber-600',
  },
  {
    value: 'dark',
    icon: Moon,
    labelKey: 'settings.general.theme_dark',
    activeIconColor: 'text-indigo-600',
  },
  SYSTEM_OPTION,
];

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/**
 * The three-way theme choice.
 *
 * A single-select `ToggleGroup` gives it one tab stop, arrow-key movement and a
 * checked state per option (Radix renders that group as a `radiogroup`, so the
 * options are radios, not switches). The sliding pill is decoration and stays
 * out of the accessibility tree, as do the icons, whose name lives on the button.
 */
export function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
  const { t } = useTranslation();
  const foundIndex = THEME_OPTIONS.findIndex((option) => option.value === theme);
  const activeIndex = foundIndex === -1 ? THEME_OPTIONS.length - 1 : foundIndex;
  const activeOption = THEME_OPTIONS[activeIndex] ?? SYSTEM_OPTION;

  return (
    <ToggleGroup.Root
      type='single'
      // Tied to the option the pill sits behind, so the announced state and the
      // visible one cannot disagree.
      value={activeOption.value}
      // Pressing the active option clears the group, and the theme has no empty
      // state: an empty value is ignored so the choice stays where it was.
      onValueChange={(value) => {
        if (value) setTheme(value as Theme);
      }}
      aria-label={t('settings.general.theme')}
      className='no-drag relative inline-flex h-full rounded-full border border-zinc-500/20 p-0.5 dark:border-zinc-400/20'
    >
      {/* The pill slides to the active option rather than jumping. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-y-0.5 left-0.5 aspect-square rounded-full bg-zinc-200/80 shadow-xs transition duration-500 ease-premium dark:bg-zinc-700/80'
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {THEME_OPTIONS.map(({ value, icon: Icon, labelKey, activeIconColor }) => {
        const isActive = activeOption.value === value;
        return (
          <ToggleGroup.Item
            key={value}
            value={value}
            aria-label={t(labelKey)}
            className={cn(
              'focus-ring relative z-content flex aspect-square h-full flex-none items-center justify-center rounded-full text-sm transition-colors',
              !isActive &&
                'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
              isActive && activeIconColor,
            )}
          >
            <Icon className='h-3/5 w-3/5 transition-colors' />
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
