import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface ServiceSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const ServiceSection: FC<ServiceSectionProps> = memo(({ settings, updateSetting }) => {
  const { t } = useTranslation();
  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.server.title')}</h3>
      <div className='grid grid-cols-2 gap-4'>
        <SettingsItem label={t('settings.server.host')}>
          <Input
            value={settings.server.host}
            onChange={(e) => updateSetting(['server', 'host'], e.target.value, true)}
          />
        </SettingsItem>
        <SettingsItem label={t('settings.server.port')}>
          <Input
            type='number'
            value={settings.server.port}
            onChange={(e) => updateSetting(['server', 'port'], parseInt(e.target.value), true)}
          />
        </SettingsItem>
      </div>
    </div>
  );
});

ServiceSection.displayName = 'ServiceSection';
