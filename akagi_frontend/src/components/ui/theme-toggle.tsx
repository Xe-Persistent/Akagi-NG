import { Laptop, Moon, Sun } from 'lucide-react';
import { type FC, memo } from 'react';

import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';

interface ThemeOption {
  value: Theme;
  icon: typeof Sun;
  activeColor: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    icon: Sun,
    activeColor: 'bg-zinc-200/80 text-amber-600 shadow-xs dark:bg-zinc-700/80',
  },
  {
    value: 'dark',
    icon: Moon,
    activeColor: 'bg-zinc-200/80 text-indigo-600 shadow-xs dark:bg-zinc-700/80',
  },
  {
    value: 'system',
    icon: Laptop,
    activeColor: 'bg-zinc-200/80 text-zinc-900 shadow-xs dark:bg-zinc-700/80 dark:text-zinc-100',
  },
];

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const ThemeToggle: FC<ThemeToggleProps> = memo(({ theme, setTheme }) => {
  const activeIndex = THEME_OPTIONS.findIndex((opt) => opt.value === theme);
  const activeOption = THEME_OPTIONS[activeIndex];

  return (
    <div className='no-drag relative inline-flex h-full gap-0 rounded-full border border-zinc-500/20 bg-transparent p-0.5 dark:border-zinc-400/20'>
      {/* 动画圆形滑块背景 - 弹性比例模式 */}
      <div
        className={cn(
          'ease-premium absolute inset-y-0.5 left-0.5 aspect-square rounded-full transition-all duration-500',
          activeOption.activeColor,
        )}
        style={{
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />

      {THEME_OPTIONS.map(({ value, icon: Icon, activeColor }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type='button'
            onClick={() => setTheme(value)}
            className={cn(
              'no-drag relative z-10 flex aspect-square h-full flex-none items-center justify-center rounded-full text-sm transition-colors focus-visible:outline-none',
              !isActive &&
                'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
            aria-label={`Switch to ${value} theme`}
          >
            <Icon
              className={cn(
                'h-[60%] w-[60%] transition-colors',
                isActive ? activeColor.split(' ').find((c) => c.startsWith('text-')) : '',
              )}
            />
          </button>
        );
      })}
    </div>
  );
});

ThemeToggle.displayName = 'ThemeToggle';
