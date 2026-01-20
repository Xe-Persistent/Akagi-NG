import type { FC } from 'react';
import { ExternalLink, Globe, Power, RefreshCw, SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SUPPORTED_LOCALES } from '@/config/locales';

interface HeaderProps {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  isConnected: boolean;
  isLaunching: boolean;
  onLaunch: () => void;
  onOpenSettings: () => void;
  locale?: string;
  onLocaleChange?: (locale: string) => void;
  onShutdown?: () => void;
}

export const Header: FC<HeaderProps> = ({
  theme,
  setTheme,
  isConnected,
  isLaunching,
  onLaunch,
  onOpenSettings,
  locale,
  onLocaleChange,
  onShutdown,
}) => {
  const { t } = useTranslation();

  return (
    <header className='sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/70 backdrop-blur-lg dark:border-zinc-800 dark:bg-black/70'>
      <div className='mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6'>
        {/* Logo & Title */}
        <div className='flex items-center gap-3'>
          <div
            className={`h-2.5 w-2.5 rounded-full shadow-sm transition-colors duration-500 ${isConnected ? 'bg-emerald-500 shadow-emerald-500/50' : 'animate-pulse bg-rose-500 shadow-rose-500/50'}`}
          />
          <h1 className='bg-linear-to-r from-pink-600 to-violet-600 bg-clip-text text-xl font-bold text-transparent dark:from-pink-400 dark:to-violet-400'>
            {t('app.title')}
          </h1>
        </div>

        {/* Actions */}
        <div className='flex items-center gap-2'>
          {/* Launch Button */}
          <Button
            variant='ghost'
            size='sm'
            className='hidden text-zinc-500 hover:text-zinc-900 sm:flex dark:text-zinc-400 dark:hover:text-zinc-100'
            onClick={onLaunch}
            disabled={isLaunching}
          >
            {isLaunching ? (
              <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <ExternalLink className='mr-2 h-4 w-4' />
            )}
            {t('app.launch_game')}
          </Button>

          {/* Language Switcher */}
          {locale && onLocaleChange && (
            <Select value={locale} onValueChange={onLocaleChange}>
              <SelectTrigger className='h-9 w-9 justify-center rounded-md border-none bg-transparent p-0 text-zinc-500 shadow-none hover:bg-zinc-100 focus:ring-0 focus:ring-offset-0 dark:text-zinc-400 dark:hover:bg-zinc-800 [&>svg:last-child]:hidden'>
                <Globe className='h-4 w-4' />
              </SelectTrigger>
              <SelectContent align='end'>
                {SUPPORTED_LOCALES.map((loc) => (
                  <SelectItem key={loc.value} value={loc.value}>
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Theme Toggle */}
          <ThemeToggle theme={theme} setTheme={setTheme} />

          {/* Settings Button */}
          <Button
            variant='ghost'
            size='icon'
            onClick={onOpenSettings}
            className='ml-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          >
            <SettingsIcon className='h-5 w-5' />
          </Button>

          {/* Shutdown Button */}
          {onShutdown && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onShutdown}
              className='ml-1 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/30'
            >
              <Power className='h-5 w-5' />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
