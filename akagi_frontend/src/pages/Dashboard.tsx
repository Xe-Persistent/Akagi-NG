import { use, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToastContainer } from 'react-toastify';

import { LaunchScreen } from '@/components/LaunchScreen';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import SettingsPanel from '@/components/SettingsPanel';
import StreamPlayer from '@/components/StreamPlayer';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { TOAST_DURATION_DEFAULT } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { fetchSettingsApi, saveSettingsApi } from '@/hooks/useSettings';
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
  const { apiBase } = useConnectionConfig();
  const initialSettings = use(settingsPromise);

  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');

  const isLanguageInitialized = useRef(false);
  if (!isLanguageInitialized.current) {
    if (initialSettings.locale && initialSettings.locale !== i18n.language) {
      i18n.changeLanguage(initialSettings.locale);
    }
    isLanguageInitialized.current = true;
  }

  const handleLocaleChange = async (newLocale: string) => {
    await i18n.changeLanguage(newLocale);
    try {
      const currentSettings = await fetchSettingsApi(apiBase);
      const newSettings = { ...currentSettings, locale: newLocale };
      await saveSettingsApi(apiBase, newSettings);
    } catch (e) {
      console.error('Failed to save locale:', e);
      notify.error(`${i18n.t('common.error')}: ${(e as Error).message}`);
    }
  };

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
    }, 1200);

    // Check optional/critical resources
    if (window.electron) {
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
    }

    return () => clearTimeout(timer);
  }, [context]);

  // Resource status notifications
  useEffect(() => {
    if (!resourceStatus) return;

    if (!resourceStatus.lib) {
      notify.error(t('status_messages.lib_missing'), { toastId: 'lib_missing', autoClose: false });
    }
    if (!resourceStatus.models) {
      notify.warn(t('status_messages.models_missing'), {
        toastId: 'models_missing',
        autoClose: false,
      });
    }
  }, [resourceStatus, t]);

  const handleLaunchGame = async () => {
    if (!window.electron) return;
    setIsLaunching(true);
    try {
      // Re-fetch settings to ensure we have the latest configuration before launching
      const currentSettings = await fetchSettingsApi(apiBase).catch(() => initialSettings);

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
  };

  const handleShutdownClick = () => {
    setShowShutdownConfirm(true);
  };

  const performShutdown = async () => {
    try {
      if (window.electron) {
        await window.electron.invoke('request-shutdown');
      }
    } catch (e) {
      console.error('Failed to shutdown:', e);
      notify.error(`${t('common.error')}: ${(e as Error).message}`);
    }
  };

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
          onOpenSettings={() => setSettingsOpen(true)}
          locale={i18n.language}
          onLocaleChange={handleLocaleChange}
          onShutdown={handleShutdownClick}
          onToggleHud={(show) => {
            window.electron?.invoke('toggle-hud', show);
            context.setIsHudActive(show);
          }}
          isHudActive={context.isHudActive}
        />
        <main className='mx-auto flex w-full grow flex-col items-center justify-center overflow-hidden px-4 py-4 sm:px-6'>
          <div className='flex h-full w-full flex-col items-center justify-center'>
            <StreamPlayer className='h-full w-full' />
          </div>
        </main>

        <Footer />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} apiBase={apiBase} />

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
