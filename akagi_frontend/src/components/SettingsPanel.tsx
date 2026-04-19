import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Separator } from '@/components/ui/separator';
import { useSettings } from '@/hooks/useSettings';

import { ConnectionSection } from './settings/ConnectionSection';
import { GeneralSection } from './settings/GeneralSection';
import { MajsoulModSection } from './settings/MajsoulModSection';
import { ModelConfigSection } from './settings/ModelConfigSection';
import { ServiceSection } from './settings/ServiceSection';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const {
    settings,
    restartRequired,
    isRestored,
    updateSetting,
    updateSettingsBatch,
    restoreDefaults,
    refreshSettings,
  } = useSettings();

  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);

  // 每次打开面板时从后端刷新，确保一致性
  useEffect(() => {
    if (open) {
      refreshSettings();
    }
  }, [open, refreshSettings]);

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className='flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl'>
        <DialogHeader className='border-border border-b p-6 pb-4'>
          <DialogTitle>{t('app.settings_title')}</DialogTitle>
          <DialogDescription>{t('app.settings_desc')}</DialogDescription>
          {restartRequired && (
            <Alert variant='warning' className='mt-4 flex items-center justify-center p-2'>
              <AlertDescription>{t('settings.restart_required')}</AlertDescription>
            </Alert>
          )}
          {isRestored && (
            <Alert variant='success' className='mt-4 flex items-center justify-center p-2'>
              <AlertDescription>{t('settings.restored_success')}</AlertDescription>
            </Alert>
          )}
        </DialogHeader>

        <div className='flex-1 overflow-y-auto p-6'>
          <ErrorBoundary
            fallback={(error: Error) => (
              <div className='flex flex-col items-center justify-center p-8 text-center'>
                <AlertTriangle className='text-destructive mb-4 h-10 w-10' />
                <h3 className='text-destructive mb-2 text-lg font-semibold'>
                  {t('common.connection_failed')}
                </h3>
                <p className='text-muted-foreground mb-4 max-w-xs text-sm whitespace-pre-wrap'>
                  {t('settings.load_error_desc')}
                  {'\n'}
                  {error.message || String(error)}
                </p>

                <Button onClick={onClose}>{t('common.close')}</Button>
          >
            <div className='grid grid-cols-2 gap-x-6 gap-y-8'>
              <GeneralSection
                settings={settings}
                updateSetting={updateSetting}
                updateSettingsBatch={updateSettingsBatch}
              />
              <ConnectionSection settings={settings} updateSetting={updateSetting} />

              <div className='col-span-2'>
                <ServiceSection settings={settings} updateSetting={updateSetting} />
              </div>

              <div className='col-span-2'>
                <ModelConfigSection settings={settings} updateSetting={updateSetting} />
              </div>

              {['majsoul', 'auto'].includes(settings.platform) && settings.mitm.enabled && (
                <div className='col-span-2'>
                  <MajsoulModSection open={open} />
                </div>
              )}

              <div className='col-span-2 flex flex-col pt-2'>
                <Separator className='my-6' />
                <div className='flex justify-end'>
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={() => setIsRestoreDialogOpen(true)}
                    className='w-auto'
                  >
                    <RotateCcw className='mr-2 h-4 w-4' />
                    {t('settings.restore')}
                  </Button>
                </div>
              </div>
            </div>
          </ErrorBoundary>
        </div>

        <AlertDialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings.restore_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('settings.restore_confirm_desc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={() => {
                  restoreDefaults();
                  setIsRestoreDialogOpen(false);
                }}
              >
                {t('settings.restore')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
