import { AlertTriangle, CheckCircle2, Download, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateLiqi } from '@/api/desktop';
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
import { notify } from '@/lib/notify';

import { ConnectionSection } from './settings/ConnectionSection';
import { GeneralSection } from './settings/GeneralSection';
import { ModelConfigSection } from './settings/ModelConfigSection';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { settings, isRestored, updateSetting, restoreDefaults, refreshSettings } = useSettings();

  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isUpdatingProtocol, setIsUpdatingProtocol] = useState(false);

  /* The refetch belongs to the panel opening, not to the callback's identity. */
  const refreshOnOpen = useEffectEvent(refreshSettings);

  // Every open panel re-reads from the main process, so an edit made elsewhere
  // cannot linger in the form.
  useEffect(() => {
    if (open) void refreshOnOpen();
  }, [open]);

  const handleUpdateProtocol = async () => {
    setIsUpdatingProtocol(true);
    try {
      await updateLiqi();
      notify.success(t('notify.proto_updated'));
    } catch (error) {
      notify.error(
        `${t('notify.proto_update_failed')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsUpdatingProtocol(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className='flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl'>
        <DialogHeader className='border-b border-border p-6 pb-4'>
          <DialogTitle>{t('app.settings_title')}</DialogTitle>
          <DialogDescription>{t('app.settings_desc')}</DialogDescription>
          {isRestored && (
            <Alert variant='success' className='mt-4 flex justify-center p-2 text-center'>
              <CheckCircle2 className='h-4 w-4' />
              <AlertDescription>{t('settings.restored_success')}</AlertDescription>
            </Alert>
          )}
        </DialogHeader>

        <div className='flex-1 overflow-y-auto p-6'>
          <ErrorBoundary
            fallback={(error: Error) => (
              <div className='flex flex-col items-center justify-center p-8 text-center'>
                <AlertTriangle className='mb-4 h-10 w-10 text-destructive' />
                <h3 className='mb-2 text-lg font-semibold text-destructive'>{t('common.error')}</h3>
                <p className='mb-4 max-w-xs text-sm whitespace-pre-wrap text-muted-foreground'>
                  {t('settings.load_error_desc')}
                  {'\n'}
                  {error.message || String(error)}
                </p>

                <Button onClick={onClose}>{t('common.close')}</Button>
              </div>
            )}
          >
            <div className='grid grid-cols-2 gap-x-6 gap-y-8'>
              <GeneralSection settings={settings} updateSetting={updateSetting} />
              <ConnectionSection settings={settings} updateSetting={updateSetting} />

              <div className='col-span-2'>
                <ModelConfigSection settings={settings} updateSetting={updateSetting} />
              </div>

              <div className='col-span-2 flex flex-col pt-2'>
                <Separator className='my-6' />
                <div className='flex items-center justify-end gap-4'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => void handleUpdateProtocol()}
                    disabled={isUpdatingProtocol}
                    className='w-auto text-muted-foreground'
                  >
                    {isUpdatingProtocol ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <Download className='mr-2 h-4 w-4' />
                    )}
                    {t('settings.update_protocol')}
                  </Button>

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
