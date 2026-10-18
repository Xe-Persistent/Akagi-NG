import {
  Copy,
  ExternalLink,
  Globe,
  Minus,
  PictureInPicture,
  RefreshCw,
  SettingsIcon,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ModelStatusIndicator } from '@/components/ui/model-status-indicator';
import { NavbarActionButton as HeaderIconButton } from '@/components/ui/navbar-action-button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SUPPORTED_LOCALES } from '@/config/locales';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface HeaderProps {
  isLaunching: boolean;
  onLaunch: () => void;
  onOpenSettings: () => void;
  locale?: string;
  onLocaleChange?: (locale: string) => void;
  /** Hides the dashboard to the tray; quitting goes through the tray menu. */
  onCloseWindow?: () => void;
  onToggleHud?: (show: boolean) => void;
  isHudActive?: boolean;
}

function HeaderContent({
  isLaunching,
  onLaunch,
  onOpenSettings,
  locale,
  onLocaleChange,
  onCloseWindow,
  onToggleHud,
  isHudActive = false,
}: HeaderProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const unsub = window.electron.on('window-state-changed', (maximized: boolean) => {
      setIsMaximized(maximized);
    });
    window.electron.invoke<boolean>('is-window-maximized').then((maximized) => {
      setIsMaximized(maximized);
    });
    return unsub;
  }, []);

  return (
    <header className='draggable z-header bg-linear-to-b from-white/50 to-transparent dark:from-black/50 dark:to-transparent'>
      <div className='flex h-16 items-center justify-between px-6'>
        {/* Logo & Title */}
        <div className='flex items-center gap-3'>
          {/* Status Indicator */}
          <div className='relative flex h-2.5 w-2.5 items-center justify-center'>
            <ModelStatusIndicator className='static' />
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
            className='no-drag text-muted-foreground hover:bg-accent hover:text-foreground flex h-full rounded-md px-3 transition-colors'
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
              <SelectTrigger className='no-drag text-muted-foreground hover:bg-accent hover:text-foreground aspect-square h-full justify-center rounded-md border-none bg-transparent p-0 shadow-none transition-colors focus:ring-0 focus:ring-offset-0 [&>svg:last-child]:hidden'>
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
              icon={PictureInPicture}
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
            iconClassName={isMaximized ? '-scale-x-100 -rotate-90' : ''}
            onClick={() => window.electron.invoke('maximize-window')}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          />

          {/* Close Window Button */}
          {onCloseWindow && (
            <HeaderIconButton
              icon={X}
              onClick={onCloseWindow}
              className='text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300'
              aria-label='Close window'
            />
          )}
        </div>
      </div>
    </header>
  );
}

export function Header(props: HeaderProps) {
  return <HeaderContent {...props} />;
}
