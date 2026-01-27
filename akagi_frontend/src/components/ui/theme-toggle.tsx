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
    activeColor: 'bg-white text-amber-500 shadow-sm dark:bg-zinc-600',
  },
  {
    value: 'dark',
    icon: Moon,
    activeColor: 'bg-white text-indigo-400 shadow-sm dark:bg-zinc-600',
  },
  {
    value: 'system',
    icon: Laptop,
    activeColor: 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100',
  },
];

interface ThemeToggleProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const ThemeToggle: FC<ThemeToggleProps> = memo(({ theme, setTheme }) => {
  return (
    <div className='flex items-center rounded-full border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-800'>
      {THEME_OPTIONS.map(({ value, icon: Icon, activeColor }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`rounded-full p-1.5 transition-all ${
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
