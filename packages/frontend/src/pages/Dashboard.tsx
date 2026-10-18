import { use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToastContainer } from 'react-toastify';

import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import SettingsPanel from '@/components/SettingsPanel';
import StreamPlayer from '@/components/StreamPlayer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TOAST_DURATION_DEFAULT } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { notify } from '@/lib/notify';
import { fetchSettingsApi } from '@/lib/settings-api';
import { cn } from '@/lib/utils';
import type { ResourceStatus, Settings } from '@/types';

interface DashboardProps {
  settingsPromise: Promise<Settings>;
  isSplashActive?: boolean;
}

function Dashboard({ settingsPromise, isSplashActive = false }: DashboardProps) {
  const { t, i18n } = useTranslation();
  const { resolvedTheme } = useTheme();
  const initialSettings = use(settingsPromise);

  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');

  const { updateSetting } = useSettings();
  const { setIsHudActive, isHudActive } = context;

  const handleLocaleChange = useCallback(
    (newLocale: string) => updateSetting(['locale'], newLocale),
    [updateSetting],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  const [resourceStatus, setResourceStatus] = useState<ResourceStatus | null>(null);

  // 1. 业务副作用：资源检查与 HUD 监听
  useEffect(() => {
    let cancelled = false;

    window.electron
      .invoke<ResourceStatus>('check-resource-status')
      .then((status) => {
        if (!cancelled) setResourceStatus(status);
      })
      .catch((error: unknown) => {
        console.error('Failed to check resource status:', error);
      });

    const unsubHud = window.electron.on('hud-visibility-changed', (visible: boolean) => {
      setIsHudActive(visible);
    });

    const unsubQuit = window.electron.on('request-app-quit', () => {
      setShowShutdownConfirm(true);
    });

    return () => {
      cancelled = true;
      unsubHud();
      unsubQuit();
    };
  }, [setIsHudActive]);

  // 2. 资源状态通知
  useEffect(() => {
    if (!resourceStatus) return;

    if (resourceStatus.models) {
      // The models showed up (or the check was retried): retire the stale warning.
      notify.dismiss('models_missing');
      return;
    }

    notify.warn(t('status.models_missing'), {
      toastId: 'models_missing',
      autoClose: false,
    });
  }, [resourceStatus, t]);

  const handleLaunchGame = useCallback(async () => {
    setIsLaunching(true);
    try {
      const currentSettings = await fetchSettingsApi().catch(() => initialSettings);
      await window.electron.invoke('start-game', {
        url: currentSettings.game_url,
        useMitm: currentSettings.mitm.enabled,
      });
    } catch (e) {
      console.error('Failed to start game window:', e);
      notify.error(t('app.launch_error'));
    } finally {
      setIsLaunching(false);
    }
  }, [initialSettings, t]);

  // The window's close button hides it to the tray; quitting is a separate flow.
  const handleCloseWindow = useCallback(() => {
    window.electron.invoke('close-window');
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
      setIsHudActive(show);
    },
    [setIsHudActive],
  );

  return (
    <>
      <div
        className={cn(
          'flex h-full flex-col transition duration-1000',
          isSplashActive ? 'pointer-events-none opacity-0 blur-xl' : 'blur-0 opacity-100',
        )}
      >
        <Header
          isLaunching={isLaunching}
          onLaunch={handleLaunchGame}
          onOpenSettings={handleOpenSettings}
          locale={i18n.language}
          onLocaleChange={handleLocaleChange}
          onCloseWindow={handleCloseWindow}
          onToggleHud={handleToggleHud}
          isHudActive={isHudActive}
        />
        <main className='flex w-full grow overflow-hidden px-6 py-4'>
          <StreamPlayer className='h-full w-full' />
        </main>

        <Footer />
      </div>

      <SettingsPanel open={settingsOpen} onClose={handleCloseSettings} />

      <AlertDialog open={showShutdownConfirm} onOpenChange={setShowShutdownConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('app.shutdown_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('app.shutdown_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                performShutdown();
                setShowShutdownConfirm(false);
              }}
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ToastContainer
        autoClose={TOAST_DURATION_DEFAULT}
        position='top-right'
        theme={resolvedTheme}
      />
    </>
  );
}

export default Dashboard;
