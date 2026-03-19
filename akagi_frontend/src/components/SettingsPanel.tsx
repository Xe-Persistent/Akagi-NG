import { AlertTriangle, RotateCcw } from 'lucide-react';
import type { FC } from 'react';
import { memo, useEffect, useState } from 'react';
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
import { StatusBar } from '@/components/ui/status-bar';
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

const SettingsPanel: FC<SettingsPanelProps> = memo(({ open, onClose }) => {
  const { t } = useTranslation();
  const {
    settings,
    restartRequired,
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
    <Modal open={open} onOpenChange={onClose} className='max-h-[90vh] max-w-4xl'>
      <ModalClose onClick={onClose} />
      <ModalHeader>
        <ModalTitle>{t('app.settings_title')}</ModalTitle>
        <ModalDescription>{t('app.settings_desc')}</ModalDescription>
        {restartRequired && (
          <StatusBar
            variant='warning'
            className='mt-4 items-center justify-center text-center'
            icon={AlertTriangle}
          >
            {t('settings.restart_required')}
          </StatusBar>
        )}
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
          <div className='space-y-8'>
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
              <GeneralSection
                settings={settings}
                updateSetting={updateSetting}
                updateSettingsBatch={updateSettingsBatch}
              />
              <ConnectionSection settings={settings} updateSetting={updateSetting} />
            </div>

            <ServiceSection settings={settings} updateSetting={updateSetting} />

            <ModelConfigSection settings={settings} updateSetting={updateSetting} />

            {['majsoul', 'auto'].includes(settings.platform) && settings.mitm.enabled && (
              <MajsoulModSection open={open} />
            )}

            <div className='flex justify-end border-t border-white/5 pt-6'>
              <Button
                variant='destructive'
                size='sm'
                onClick={() => setIsRestoreDialogOpen(true)}
                className='w-full sm:w-auto'
              >
                <RotateCcw className='mr-2 h-4 w-4' />
                {t('settings.restore')}
              </Button>
            </div>
          </div>
        </ErrorBoundary>

        <ConfirmationDialog
          open={isRestoreDialogOpen}
          onOpenChange={setIsRestoreDialogOpen}
          title={t('settings.restore_confirm_title')}
          description={t('settings.restore_confirm_desc')}
          onConfirm={restoreDefaults}
          variant='destructive'
          confirmText={t('settings.restore')}
        />
      </ModalContent>
    </Modal>
  );
});

SettingsPanel.displayName = 'SettingsPanel';

export default SettingsPanel;
