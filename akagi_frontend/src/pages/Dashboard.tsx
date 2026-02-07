import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToastContainer } from 'react-toastify';

import { LaunchScreen } from '@/components/LaunchScreen';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import SettingsPanel from '@/components/SettingsPanel';
import StreamPlayer from '@/components/StreamPlayer';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { APP_SPLASH_DELAY_MS, TOAST_DURATION_DEFAULT } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { fetchSettingsApi, useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import type { ResourceStatus, Settings } from '@/types';

interface DashboardProps {
  settingsPromise: Promise<Settings>;
}

function Dashboard({ settingsPromise }: DashboardProps) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const initialSettings = use(settingsPromise);

  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');

  const { settings, updateSetting } = useSettings();

  const isLanguageInitialized = useRef(false);
  if (!isLanguageInitialized.current) {
    if (settings && settings.locale && settings.locale !== i18n.language) {
      i18n.changeLanguage(settings.locale);
    }
    isLanguageInitialized.current = true;
  }

  const handleLocaleChange = useCallback(
    async (newLocale: string) => {
      await i18n.changeLanguage(newLocale);
      window.electron.invoke('update-locale', newLocale);
      updateSetting(['locale'], newLocale as string);
    },
    [i18n, updateSetting],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [resourceStatus, setResourceStatus] = useState<{
    lib: boolean;
    models: boolean;
  } | null>(null);

  useEffect(() => {
    setIsMounted(true);
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, APP_SPLASH_DELAY_MS);

    // Check optional/critical resources
    window.electron.invoke('check-resource-status').then((status) => {
      setResourceStatus(status as ResourceStatus);
    });

    // Listen for HUD visibility changes from Electron (e.g. window closed/hidden)
    const unsubHud = window.electron.on('hud-visibility-changed', (visible) => {
      context.setIsHudActive(visible as boolean);
    });

    return () => {
      clearTimeout(timer);
      if (unsubHud) unsubHud();
    };
  }, [context]);

  // Resource status notifications
  useEffect(() => {
    if (!resourceStatus) return;

    if (!resourceStatus.lib) {
      notify.error(t('status_messages.lib_missing'), { toastId: 'lib_missing', autoClose: false });
    }
    if (!resourceStatus.models && !initialSettings.ot.online) {
      notify.warn(t('status_messages.models_missing'), {
        toastId: 'models_missing',
        autoClose: false,
      });
    }
  }, [resourceStatus, t, initialSettings.ot.online]);

  const handleLaunchGame = useCallback(async () => {
    setIsLaunching(true);
    try {
      // Re-fetch settings to ensure we have the latest configuration before launching
      const currentSettings = await fetchSettingsApi().catch(() => initialSettings);

      // Pass the configured URL, MITM status and platform to Electron
      await window.electron.invoke('start-game', {
        url: currentSettings.game_url,
        useMitm: currentSettings.mitm.enabled,
        platform: currentSettings.platform,
      });
    } catch (e) {
      console.error('Failed to start game window:', e);
      notify.error(t('app.launch_error'));
    } finally {
      setIsLaunching(false);
    }
  }, [initialSettings, t]);

  const handleShutdownClick = useCallback(() => {
    setShowShutdownConfirm(true);
  }, []);

  const performShutdown = useCallback(async () => {
    try {
      await window.electron.invoke('request-shutdown');
    } catch (e) {
      console.error('Failed to shutdown:', e);
      notify.error(`${t('common.error')}: ${(e as Error).message}`);
    }
  }, [t]);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleToggleHud = useCallback(
    (show: boolean) => {
      window.electron.invoke('toggle-hud', show);
      context.setIsHudActive(show);
    },
    [context],
  );

  return (
    <div className='relative flex h-screen flex-col overflow-hidden text-zinc-900 dark:text-zinc-50'>
      {showSplash && (
        <LaunchScreen
          isStatic
          className='animate-out fade-out zoom-out-95 fill-mode-forwards pointer-events-none fixed inset-0 z-50 duration-1000'
        />
      )}

      <div
        className={cn(
          'flex h-full flex-col transition-all duration-1000 ease-out',
          isMounted ? 'blur-0 opacity-100' : 'opacity-0 blur-xl',
        )}
      >
        <Header
          isLaunching={isLaunching}
          onLaunch={handleLaunchGame}
          onOpenSettings={handleOpenSettings}
          locale={i18n.language}
          onLocaleChange={handleLocaleChange}
          onShutdown={handleShutdownClick}
          onToggleHud={handleToggleHud}
          isHudActive={context.isHudActive}
        />
        <main className='mx-auto flex w-full grow flex-col items-center justify-center overflow-hidden px-4 py-4 sm:px-6'>
          <div className='flex h-full w-full flex-col items-center justify-center'>
            <StreamPlayer className='h-full w-full' />
          </div>
        </main>

        <Footer />
      </div>

      <SettingsPanel open={settingsOpen} onClose={handleCloseSettings} />

      <ConfirmationDialog
        open={showShutdownConfirm}
        onOpenChange={setShowShutdownConfirm}
        title={t('app.shutdown_confirm_title')}
        description={t('app.shutdown_confirm_desc')}
        onConfirm={performShutdown}
        variant='destructive'
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
      />
      <ToastContainer
        autoClose={TOAST_DURATION_DEFAULT}
        position='top-right'
        theme={
          theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : theme
        }
      />
    </div>
  );
}

export default Dashboard;
