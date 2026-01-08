import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
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
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { Settings } from '@/types';

export default function App() {
  // Hooks
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();

  // DataServer Configuration
  const [protocol] = useState(() => localStorage.getItem('protocol') || 'http');
  const [backendAddress] = useState(
    () => localStorage.getItem('backendAddress') || '127.0.0.1:8765',
  );
  const [clientId] = useState(() => {
    let id = localStorage.getItem('clientId');
    if (!id) {
      id = Math.random().toString(36).slice(2);
      localStorage.setItem('clientId', id);
    }
    return id;
  });

  const apiBase = `${protocol}://${backendAddress}`;
  const backendUrl = `${protocol}://${backendAddress}/sse?clientId=${clientId}`;

  const { data: fullRecData, isConnected, error, systemError } = useSSEConnection(backendUrl);
  const [locale, setLocale] = useState<string>('zh-CN');

  // Effect: Initial Settings Fetch & Sync Locale
  const syncSettings = async () => {
    try {
      const settings = await fetchSettingsApi(apiBase);
      if (settings.locale && settings.locale !== i18n.language) {
        i18n.changeLanguage(settings.locale);
        setLocale(settings.locale);
      }
    } catch (e) {
      console.error('Failed to sync settings:', e);
    }
  };

  useEffect(() => {
    syncSettings();
  }, [apiBase]);

  // Handler: Update Locale from Header (Direct Save)
  const handleLocaleChange = async (newLocale: string) => {
    try {
      const currentSettings = await fetchSettingsApi(apiBase);
      const newSettings = { ...currentSettings, locale: newLocale };
      await saveSettingsApi(apiBase, newSettings);
      i18n.changeLanguage(newLocale);
      setLocale(newLocale);
    } catch (e) {
      console.error('Failed to save locale:', e);
      notify.error(`${t('app.save_failed')}: ${(e as Error).message}`);
    }
  };

  // UI States
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  // Handlers
  const handleOpenMajsoul = async () => {
    setIsLaunching(true);
    try {
      const data = await fetchJson<Pick<Settings, 'majsoul_url'>>(`${apiBase}/api/settings`);

      if (data?.majsoul_url) {
        window.open(data.majsoul_url, '_blank');
      } else {
        notify.error(`${t('app.config_error')}: ${t('app.launch_error_url')}`);
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

      const title = t('app.stopped_title');
      const desc = t('app.stopped_desc');

      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100vh; align-items: center; justify-content: center; background: #18181b; color: #fff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 24px;">
            <path d="M12 2v10"></path>
            <path d="M18.4 6.6a9 9 0 1 1-12.77 0"></path>
          </svg>
          <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #f43f5e; font-weight: 700;">${title}</h1>
          <p style="color: #a1a1aa; font-size: 1.1rem;">${desc}</p>
        </div>
      `;
    } catch (e) {
      console.error('Failed to shutdown:', e);
      notify.error(`${t('app.server_error')}: ${(e as Error).message}`);
    }
  };

  return (
    <div className='relative flex min-h-screen flex-col text-zinc-900 dark:text-zinc-50'>
      {/* System Error Modal */}
      {systemError && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm'>
          <div className='w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-rose-900 dark:bg-zinc-900'>
            <div className='mb-4 flex items-center justify-center text-rose-600 dark:text-rose-500'>
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='48'
                height='48'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='m15 9-6 6' />
                <path d='m9 9 6 6' />
              </svg>
            </div>
            <h2 className='mb-2 text-center text-xl font-bold text-rose-700 dark:text-rose-400'>
              {t(`app.${systemError.code.toLowerCase()}`, { defaultValue: t('app.config_error') })}
            </h2>
            <p className='mb-2 text-center text-zinc-600 dark:text-zinc-300'>
              {t(`app.${systemError.code.toLowerCase()}_desc`)}
            </p>
            {systemError.details && (
              <div className='mb-6 rounded bg-zinc-100 p-2 text-center font-mono text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'>
                {systemError.details}
              </div>
            )}
          </div>
        </div>
      )}

      <Header
        theme={theme}
        setTheme={setTheme}
        isConnected={isConnected}
        error={error}
        isLaunching={isLaunching}
        onLaunch={handleOpenMajsoul}
        onOpenSettings={() => setSettingsOpen(true)}
        locale={locale} // Pass current locale
        onLocaleChange={handleLocaleChange} // Pass handler
        onShutdown={handleShutdownClick}
      />

      <main className='mx-auto flex w-full max-w-350 grow flex-col items-center justify-start gap-8 px-4 py-8 sm:px-6'>
        {/* Status Bar: Show error message on mobile */}
        {error && (
          <div className='w-full rounded-lg border border-rose-100 bg-rose-50 p-3 text-center text-sm text-rose-600 sm:hidden dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400'>
            {error}
          </div>
        )}

        {/* Player Container */}
        <div className='w-full'>
          <StreamPlayer data={fullRecData} />
        </div>

        {/* Mobile Launch Button (Shown when hidden on Header) */}
        <div className='w-full sm:hidden'>
          <Button variant='outline' className='w-full' onClick={handleOpenMajsoul}>
            <ExternalLink className='mr-2 h-4 w-4' />
            {t('app.launch_majsoul')}
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
        autoClose={5000}
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
