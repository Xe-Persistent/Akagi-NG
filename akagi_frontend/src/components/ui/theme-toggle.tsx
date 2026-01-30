import { Laptop, Moon, Sun } from 'lucide-react';
import { type FC, memo } from 'react';

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
  return (
    <div className='no-drag flex items-center rounded-full border border-zinc-500/20 bg-transparent p-1 dark:border-zinc-400/20'>
      {THEME_OPTIONS.map(({ value, icon: Icon, activeColor }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`no-drag rounded-full p-1.5 transition-all ${
            theme === value
              ? activeColor
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
          aria-label={`Switch to ${value} theme`}
        >
          <Icon className='h-4 w-4' />
        </button>
      ))}
    </div>
  );
});

ThemeToggle.displayName = 'ThemeToggle';
