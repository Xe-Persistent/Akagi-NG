import { Laptop, Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Theme } from '@/types';

interface ThemeOption {
  value: Theme;
  icon: typeof Sun;
  /** Background of the sliding pill while this option is active. */
  activeColor: string;
  /** Tint of the icon while this option is active. */
  activeIconColor: string;
}

/** The option an unknown theme falls back to; also the last one in the list. */
const SYSTEM_OPTION: ThemeOption = {
  value: 'system',
  icon: Laptop,
  activeColor: 'bg-zinc-200/80 shadow-xs dark:bg-zinc-700/80',
  activeIconColor: 'text-zinc-900 dark:text-zinc-100',
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    icon: Sun,
    activeColor: 'bg-zinc-200/80 shadow-xs dark:bg-zinc-700/80',
    activeIconColor: 'text-amber-600',
  },
  {
    value: 'dark',
    icon: Moon,
    activeColor: 'bg-zinc-200/80 shadow-xs dark:bg-zinc-700/80',
    activeIconColor: 'text-indigo-600',
  },
  SYSTEM_OPTION,
];

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export function ThemeToggle({ theme, setTheme }: ThemeToggleProps) {
  const foundIndex = THEME_OPTIONS.findIndex((opt) => opt.value === theme);
  const activeIndex = foundIndex === -1 ? THEME_OPTIONS.length - 1 : foundIndex;
  const activeOption = THEME_OPTIONS[activeIndex] ?? SYSTEM_OPTION;

  return (
    <div className='no-drag relative inline-flex h-full rounded-full border border-zinc-500/20 p-0.5 dark:border-zinc-400/20'>
      {/* The pill slides to the active option rather than jumping. */}
      <div
        className={cn(
          'ease-premium absolute inset-y-0.5 left-0.5 aspect-square rounded-full transition duration-500',
          activeOption.activeColor,
        )}
        style={{
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />

      {THEME_OPTIONS.map(({ value, icon: Icon, activeIconColor }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type='button'
            onClick={() => setTheme(value)}
            className={cn(
              'z-content relative flex aspect-square h-full flex-none items-center justify-center rounded-full text-sm transition-colors focus-visible:outline-none',
              !isActive &&
                'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
            aria-label={`Switch to ${value} theme`}
          >
            <Icon className={cn('h-3/5 w-3/5 transition-colors', isActive && activeIconColor)} />
          </button>
        );
      })}
    </div>
  );
}
