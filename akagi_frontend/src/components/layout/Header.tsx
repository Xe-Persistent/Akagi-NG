import {
  Copy,
  ExternalLink,
  Globe,
  Minus,
  Monitor,
  RefreshCw,
  SettingsIcon,
  Square,
  X,
} from 'lucide-react';
import type { FC } from 'react';
import { use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SUPPORTED_LOCALES } from '@/config/locales';
import { GameContext } from '@/contexts/GameContext';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import type { HeaderProps } from '@/types';

export const Header: FC<HeaderProps> = ({
  isLaunching,
  onLaunch,
  onOpenSettings,
  locale,
  onLocaleChange,
  onShutdown,
  onToggleHud,
  isHudActive = false,
}) => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const gameContext = use(GameContext);
  if (!gameContext) throw new Error('GameContext not found');
  const { isConnected } = gameContext;

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (window.electron) {
      const unsub = window.electron.on('window-state-changed', (maximized) => {
        setIsMaximized(maximized as boolean);
      });
      // Initial check
      window.electron.invoke('is-window-maximized').then((maximized) => {
        setIsMaximized(maximized as boolean);
      });
      return unsub;
    }
  }, []);

  return (
    <header className='draggable sticky top-0 z-40 w-full bg-linear-to-b from-white/50 to-transparent backdrop-blur-md dark:from-black/50 dark:to-transparent'>
      <div className='flex h-16 w-full items-center justify-between px-4 sm:px-6'>
        {/* Logo & Title */}
        <div className='no-drag flex items-center gap-3'>
          <div
            className={`h-2.5 w-2.5 rounded-full shadow-sm transition-colors duration-500 ${isConnected ? 'bg-emerald-500 shadow-emerald-500/50' : 'animate-pulse bg-rose-500 shadow-rose-500/50'}`}
          />
          <h1 className='bg-linear-to-r from-pink-600 to-violet-600 bg-clip-text text-xl font-bold text-transparent dark:from-pink-400 dark:to-violet-400'>
            {t('app.title')}
          </h1>
        </div>

        {/* Actions */}
        <div className='flex items-center gap-1'>
          {/* Launch Button */}
          <Button
            variant='ghost'
            size='sm'
            className='no-drag hidden rounded-md px-3 py-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 sm:flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
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
              <SelectTrigger className='no-drag h-9 w-9 justify-center rounded-md border-none bg-transparent p-0 text-zinc-500 shadow-none transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus:ring-0 focus:ring-offset-0 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 [&>svg:last-child]:hidden'>
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
            className='no-drag text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          >
            <SettingsIcon className='h-5 w-5' />
          </Button>

          {/* HUD Toggle Button (Electron only) */}
          {window.electron && onToggleHud && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => onToggleHud(!isHudActive)}
              className={cn(
                'no-drag transition-colors',
                isHudActive
                  ? 'bg-violet-100 text-violet-600 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
              )}
            >
              <Monitor className='h-5 w-5' />
            </Button>
          )}

          {/* Minimize Button */}
          {window.electron && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => window.electron?.invoke('minimize-window')}
              className='no-drag text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            >
              <Minus className='h-5 w-5' />
            </Button>
          )}

          {/* Maximize Button */}
          {window.electron && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => window.electron?.invoke('maximize-window')}
              className='no-drag text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            >
              {isMaximized ? (
                <Copy className='h-3 w-3 scale-x-[-1] -rotate-90' />
              ) : (
                <Square className='h-3.5 w-3.5' />
              )}
            </Button>
          )}

          {/* Shutdown Button */}
          {onShutdown && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onShutdown}
              className='no-drag text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300'
            >
              <X className='h-5 w-5' />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
