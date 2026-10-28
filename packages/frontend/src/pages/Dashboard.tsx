import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { useGame } from '@/hooks/useGame';
import { useLaunchGame } from '@/hooks/useLaunchGame';
import { useModelsMissingToast } from '@/hooks/useModelsMissingToast';
import { useResourceStatus } from '@/hooks/useResourceStatus';
import { useShutdownDialog } from '@/hooks/useShutdownDialog';
import { cn } from '@/lib/utils';

interface DashboardProps {
  isSplashActive?: boolean;
}

function Dashboard({ isSplashActive = false }: DashboardProps) {
  const { t } = useTranslation();
  const { status } = useGame();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const resourceStatus = useResourceStatus();
  useModelsMissingToast(resourceStatus, status?.model);

  const { isLaunching, launch } = useLaunchGame();
  const {
    isOpen: isShutdownOpen,
    setIsOpen: setShutdownOpen,
    confirm: confirmShutdown,
  } = useShutdownDialog();

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <>
      <div
        className={cn(
          // Cross-fades in as the splash fades out (APP_SPLASH_EXIT_MS).
          'flex h-full flex-col transition duration-1000',
          isSplashActive ? 'pointer-events-none opacity-0 blur-xl' : 'blur-0 opacity-100',
        )}
      >
        <Header
          isLaunching={isLaunching}
          onLaunch={() => void launch()}
          onOpenSettings={handleOpenSettings}
        />

        <main className='flex w-full grow overflow-hidden px-6 py-4'>
          <StreamPlayer className='h-full w-full' />
        </main>

        <Footer />
      </div>

      <SettingsPanel open={settingsOpen} onClose={handleCloseSettings} />

      <AlertDialog open={isShutdownOpen} onOpenChange={setShutdownOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('app.shutdown_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('app.shutdown_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => void confirmShutdown()}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default Dashboard;
