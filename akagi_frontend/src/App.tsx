import 'react-toastify/dist/ReactToastify.css';

import { ExternalLink, Power } from 'lucide-react';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToastContainer } from 'react-toastify';

import { GameProvider } from '@/components/GameProvider';
import { LaunchScreen } from '@/components/LaunchScreen';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { GameContext } from '@/contexts/GameContext';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { fetchSettingsApi, saveSettingsApi } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { fetchJson } from '@/lib/api-client';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import type { Settings } from '@/types';

import SettingsPanel from './components/SettingsPanel.tsx';
import StreamPlayer from './components/StreamPlayer';
import { TOAST_DURATION_DEFAULT } from './config/constants';

interface AppContentProps {
  settingsPromise: Promise<Settings>;
}

function AppContent({ settingsPromise }: AppContentProps) {
  // Hooks
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const { apiBase } = useConnectionConfig();
  const initialSettings = use(settingsPromise);

  // Context
  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');
  const { statusMessage, statusType } = context;

  // 初始设置获取和语言同步
  useEffect(() => {
    if (initialSettings.locale && initialSettings.locale !== i18n.language) {
      i18n.changeLanguage(initialSettings.locale);
    }
  }, [initialSettings.locale, i18n]);

  const handleLocaleChange = async (newLocale: string) => {
    await i18n.changeLanguage(newLocale);

    try {
      const currentSettings = await fetchSettingsApi(apiBase);
      const newSettings = { ...currentSettings, locale: newLocale };
      await saveSettingsApi(apiBase, newSettings);
      notify.success(i18n.t('settings.status_saved'));
    } catch (e) {
      console.error('Failed to save locale:', e);
      notify.error(`${i18n.t('common.error')}: ${(e as Error).message}`);
    }
  };

  // UI 状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isShutdown, setIsShutdown] = useState(false);

  // 淡入淡出
  const [showSplash, setShowSplash] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // 消息处理
  const handleOpenMajsoul = async () => {
    setIsLaunching(true);
    try {
      const settings = await fetchSettingsApi(apiBase);
      const url = settings.browser.url;

      if (url) {
        window.open(url, '_blank');
      } else {
        notify.error(`${t('status_messages.config_error')}: ${t('app.launch_error')}`);
      }
    } catch (e) {
      console.error('Failed to fetch settings:', e);
      notify.error(`${(e as Error).message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleShutdownClick = () => {
    setShowShutdownConfirm(true);
  };

  const performShutdown = async () => {
    try {
      await fetchJson(`${apiBase}/api/shutdown`, { method: 'POST' });
      setIsShutdown(true);
    } catch (e) {
      console.error('Failed to shutdown:', e);
      notify.error(`${t('common.error')}: ${(e as Error).message}`);
    }
  };

  if (isShutdown) {
    return (
      <div className='animate-in fade-in zoom-in-95 flex h-screen flex-col items-center justify-center duration-500'>
        <Power className='mb-6 h-16 w-16 text-rose-500' strokeWidth={2} />
        <h1 className='mb-4 text-3xl font-bold text-rose-500'>{t('app.stopped_title')}</h1>
        <p className='text-lg text-zinc-500 dark:text-zinc-400'>{t('app.stopped_desc')}</p>
      </div>
    );
  }

  return (
    <div className='relative flex min-h-screen flex-col text-zinc-900 dark:text-zinc-50'>
      {/* Launch Screen Fade Out Overlay */}
      {showSplash && (
        <LaunchScreen
          isStatic
          className='animate-out fade-out zoom-out-95 fill-mode-forwards pointer-events-none fixed inset-0 z-50 duration-1000'
        />
      )}

      {/* Main Content with Blur Entry Transition */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-all duration-1000 ease-out',
          isMounted ? 'blur-0 opacity-100' : 'opacity-0 blur-xl',
        )}
      >
        <Header
          isLaunching={isLaunching}
          onLaunch={handleOpenMajsoul}
          onOpenSettings={() => setSettingsOpen(true)}
          locale={i18n.language}
          onLocaleChange={handleLocaleChange}
          onShutdown={handleShutdownClick}
        />

        <main className='mx-auto flex w-full max-w-350 grow flex-col items-center justify-start gap-8 px-4 py-8 sm:px-6'>
          {/* Status Bar: Show error message or notifications */}
          {statusMessage && (
            <div className={`status-bar status-${statusType}`}>{statusMessage}</div>
          )}

          {/* Player Container */}
          <div className='w-full'>
            <StreamPlayer />
          </div>

          {/* Mobile Launch Button (Shown when hidden on Header) */}
          <div className='w-full sm:hidden'>
            <Button variant='outline' className='w-full' onClick={handleOpenMajsoul}>
              <ExternalLink className='mr-2 h-4 w-4' />
              {t('app.launch_game')}
            </Button>
          </div>
        </main>

        <Footer />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        apiBase={apiBase}
      />

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

export default function App() {
  const { apiBase } = useConnectionConfig();

  const settingsPromise = useMemo(() => {
    const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    return Promise.all([fetchSettingsApi(apiBase), minDelay]).then(([settings]) => settings);
  }, [apiBase]);

  return (
    <Suspense fallback={<LaunchScreen />}>
      <ThemeProvider>
        <GameProvider>
          <AppContent settingsPromise={settingsPromise} />
        </GameProvider>
      </ThemeProvider>
    </Suspense>
  );
}
