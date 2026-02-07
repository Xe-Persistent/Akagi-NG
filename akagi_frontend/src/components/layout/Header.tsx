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
import { type ComponentProps, memo, use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ModelStatusIndicator } from '@/components/ui/model-status-indicator';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SUPPORTED_LOCALES } from '@/config/locales';
import { GameContext } from '@/contexts/GameContext';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface HeaderProps {
  isLaunching: boolean;
  onLaunch: () => void;
  onOpenSettings: () => void;
  locale?: string;
  onLocaleChange?: (locale: string) => void;
  onShutdown?: () => void;
  onToggleHud?: (show: boolean) => void;
  isHudActive?: boolean;
  isConnected: boolean;
}

interface HeaderIconButtonProps extends ComponentProps<typeof Button> {
  icon: typeof SettingsIcon;
  iconClassName?: string;
  badge?: boolean;
}

const HeaderIconButton: FC<HeaderIconButtonProps> = ({
  icon: Icon,
  className,
  iconClassName,
  badge,
  ...props
}) => (
  <Button
    variant='ghost'
    size='icon'
    className={cn(
      'no-drag relative aspect-square h-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
      className,
    )}
    {...props}
  >
    <Icon className={cn('h-5 w-5', iconClassName)} />
    {badge && (
      <span className='absolute top-1 right-1 flex h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50' />
    )}
  </Button>
);

const HeaderContent: FC<HeaderProps> = memo(
  ({
    isLaunching,
    onLaunch,
    onOpenSettings,
    locale,
    onLocaleChange,
    onShutdown,
    onToggleHud,
    isHudActive = false,
    isConnected,
  }) => {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
      const unsub = window.electron.on('window-state-changed', (maximized) => {
        setIsMaximized(maximized as boolean);
      });
      window.electron.invoke('is-window-maximized').then((maximized) => {
        setIsMaximized(maximized as boolean);
      });
      return unsub;
    }, []);

    return (
      <header className='draggable top-0 z-40 w-full bg-linear-to-b from-white/50 to-transparent dark:from-black/50 dark:to-transparent'>
        <div className='flex h-16 w-full items-center justify-between px-4 sm:px-6'>
          {/* Logo & Title */}
          <div className='no-drag flex items-center gap-3'>
            {/* Status Indicator */}
            <div className='relative flex h-2.5 w-2.5 items-center justify-center'>
              <ModelStatusIndicator
                isConnected={isConnected}
                className='static inset-auto top-auto left-auto m-0 transform-none animate-none'
              />
            </div>
            <h1 className='bg-linear-to-r from-pink-600 to-violet-600 bg-clip-text text-xl font-bold text-transparent dark:from-pink-400 dark:to-violet-400'>
              {t('app.title')}
            </h1>
          </div>

          {/* Actions - Control Group */}
          <div className='flex h-9 items-center gap-1'>
            {/* Launch Button */}
            <Button
              variant='ghost'
              size='sm'
              className='no-drag hidden h-full rounded-md px-3 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 sm:flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
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
                <SelectTrigger className='no-drag aspect-square h-full justify-center rounded-md border-none bg-transparent p-0 text-zinc-500 shadow-none transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus:ring-0 focus:ring-offset-0 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 [&>svg:last-child]:hidden'>
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
            <HeaderIconButton
              icon={SettingsIcon}
              onClick={onOpenSettings}
              aria-label='Open settings'
            />

            {/* HUD Toggle Button */}
            {onToggleHud && (
              <HeaderIconButton
                icon={Monitor}
                onClick={() => onToggleHud(!isHudActive)}
                className={cn(
                  isHudActive &&
                    'bg-violet-100 text-violet-600 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50',
                )}
                aria-label='Toggle HUD'
              />
            )}

            {/* Window Controls */}
            <HeaderIconButton
              icon={Minus}
              onClick={() => window.electron.invoke('minimize-window')}
              aria-label='Minimize'
            />

            <HeaderIconButton
              icon={isMaximized ? Copy : Square}
              iconClassName={isMaximized ? 'scale-x-[-1] -rotate-90 h-3 w-3' : 'h-3 w-3'}
              onClick={() => window.electron.invoke('maximize-window')}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
            />

            {/* Shutdown Button */}
            {onShutdown && (
              <HeaderIconButton
                icon={X}
                onClick={onShutdown}
                className='text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300'
                aria-label='Shutdown'
              />
            )}
          </div>
        </div>
      </header>
    );
  },
);

HeaderContent.displayName = 'HeaderContent';

export const Header: FC<Omit<HeaderProps, 'isConnected'>> = (props) => {
  const gameContext = use(GameContext);
  if (!gameContext) throw new Error('GameContext not found');
  const { isConnected } = gameContext;

  return <HeaderContent {...props} isConnected={isConnected} />;
};
