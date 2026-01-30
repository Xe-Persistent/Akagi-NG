import { AlertTriangle, Loader2 } from 'lucide-react';
import type { FC } from 'react';
import { Suspense, use, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { fetchSettingsApi, useSettings } from '@/hooks/useSettings';
import type { Settings, SettingsPanelProps } from '@/types';

import { ConnectionSection } from './settings/ConnectionSection';
import { DangerZoneSection } from './settings/DangerZoneSection';
import { GeneralSection } from './settings/GeneralSection';
import { OnlineModelSection } from './settings/OnlineModelSection';
import { ServiceSection } from './settings/ServiceSection';

interface SettingsFormProps {
  apiBase: string;
  settingsPromise: Promise<Settings>;
}

const SettingsForm = ({ apiBase, settingsPromise }: SettingsFormProps) => {
  const initialSettings = use(settingsPromise);
  const { t } = useTranslation();

  const { settings, restartRequired, updateSetting, updateSettingsBatch, restoreDefaults } =
    useSettings(apiBase, initialSettings);

  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);

  if (!settings) return null;

  return (
    <>
      <div className='space-y-8'>
        {restartRequired && (
          <div className='alert-box alert-warning'>
            <AlertTriangle className='h-4 w-4' />
            {t('settings.restart_required')}
          </div>
        )}

        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <GeneralSection
            settings={settings}
            updateSetting={updateSetting}
            updateSettingsBatch={updateSettingsBatch}
          />
          <ConnectionSection settings={settings} updateSetting={updateSetting} />
        </div>

        <ServiceSection settings={settings} updateSetting={updateSetting} />

        <OnlineModelSection settings={settings} updateSetting={updateSetting} />

        <DangerZoneSection
          settings={settings}
          updateSetting={updateSetting}
          busy={false}
          onRestoreDefaults={() => setIsRestoreDialogOpen(true)}
        />
      </div>

      <ConfirmationDialog
        open={isRestoreDialogOpen}
        onOpenChange={setIsRestoreDialogOpen}
        title={t('settings.restore_confirm_title')}
        description={t('settings.restore_confirm_desc')}
        onConfirm={restoreDefaults}
        variant='destructive'
        confirmText={t('settings.restore')}
      />
    </>
  );
};

const SettingsPanel: FC<SettingsPanelProps> = ({ open, onClose, apiBase }) => {
  const { t } = useTranslation();
  const settingsPromise = useMemo(() => {
    if (open) {
      return fetchSettingsApi(apiBase);
    }
    return null;
  }, [open, apiBase]);

  if (!open) return null;

  return (
    <Modal open={open} onOpenChange={onClose} className='max-h-[90vh] max-w-4xl'>
      <ModalClose onClick={onClose} />
      <ModalHeader>
        <ModalTitle>{t('app.settings_title')}</ModalTitle>
        <ModalDescription>{t('app.settings_desc')}</ModalDescription>
      </ModalHeader>

      <ModalContent>
        <ErrorBoundary
          fallback={() => (
            <div className='flex flex-col items-center justify-center p-8 text-center'>
              <AlertTriangle className='text-destructive mb-4 h-10 w-10' />
              <h3 className='text-destructive mb-2 text-lg font-semibold'>
                {t('common.connection_failed')}
              </h3>
              <p className='text-muted-foreground mb-4 max-w-xs'>{t('settings.load_error_desc')}</p>

              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          )}
        >
          <Suspense
            fallback={
              <div className='text-muted-foreground flex flex-col items-center justify-center space-y-4 p-12'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <p>{t('settings.loading')}</p>
              </div>
            }
          >
            {settingsPromise && (
              <SettingsForm apiBase={apiBase} settingsPromise={settingsPromise} />
            )}
          </Suspense>
        </ErrorBoundary>
      </ModalContent>
    </Modal>
  );
};

export default SettingsPanel;
