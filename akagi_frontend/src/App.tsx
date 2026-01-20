import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { fetchJson } from '@/lib/api-client';
import { notify } from '@/lib/notify';
import StreamPlayer from './components/StreamPlayer';
import SettingsPanel from './components/SettingsPanel.tsx';
import { fetchSettingsApi, saveSettingsApi } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { useSSEConnection } from '@/hooks/useSSEConnection';
import { useStatusNotification } from '@/hooks/useStatusNotification';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { TOAST_DURATION_DEFAULT } from './config/constants';

export default function App() {
  // Hooks
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const { apiBase, backendUrl } = useConnectionConfig();

  const { data: fullRecData, notifications, isConnected, error } = useSSEConnection(backendUrl);
  const { statusMessage, statusType } = useStatusNotification(notifications, error);
  const [locale, setLocale] = useState<string>('zh-CN');

  // 初始设置获取和语言同步
  const syncSettings = useCallback(async () => {
    try {
      const settings = await fetchSettingsApi(apiBase);
      if (settings.locale && settings.locale !== i18n.language) {
        i18n.changeLanguage(settings.locale);
        setLocale(settings.locale);
      }
    } catch (e) {
      console.error('Failed to sync settings:', e);
    }
  }, [apiBase, i18n]);

  useEffect(() => {
    syncSettings();
  }, [syncSettings]);

  // 处理语言切换（直接保存）
  const handleLocaleChange = async (newLocale: string) => {
    try {
      const currentSettings = await fetchSettingsApi(apiBase);
      const newSettings = { ...currentSettings, locale: newLocale };
      await saveSettingsApi(apiBase, newSettings);
      i18n.changeLanguage(newLocale);
      setLocale(newLocale);
    } catch (e) {
      console.error('Failed to save locale:', e);
      notify.error(`${t('common.error')}: ${(e as Error).message}`);
    }
  };

  // UI 状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

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

  const [isShutdown, setIsShutdown] = useState(false);

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
      <div className='flex h-screen flex-col items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50'>
        <Power className='mb-6 h-16 w-16 text-rose-500' strokeWidth={2} />
        <h1 className='mb-4 text-3xl font-bold text-rose-500'>{t('app.stopped_title')}</h1>
        <p className='text-lg text-zinc-500 dark:text-zinc-400'>{t('app.stopped_desc')}</p>
      </div>
    );
  }

  return (
    <div className='relative flex min-h-screen flex-col text-zinc-900 dark:text-zinc-50'>
      <Header
        theme={theme}
        setTheme={setTheme}
        isConnected={isConnected}
        isLaunching={isLaunching}
        onLaunch={handleOpenMajsoul}
        onOpenSettings={() => setSettingsOpen(true)}
        locale={locale} // Pass current locale
        onLocaleChange={handleLocaleChange} // Pass handler
        onShutdown={handleShutdownClick}
      />

      <main className='mx-auto flex w-full max-w-350 grow flex-col items-center justify-start gap-8 px-4 py-8 sm:px-6'>
        {/* Status Bar: Show error message or notifications */}
        {statusMessage && <div className={`status-bar status-${statusType}`}>{statusMessage}</div>}

        {/* Player Container */}
        <div className='w-full'>
          <StreamPlayer data={fullRecData} />
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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          syncSettings(); // Refresh settings (language might have changed in panel)
        }}
        apiBase={apiBase}
        theme={theme}
        setTheme={setTheme}
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
