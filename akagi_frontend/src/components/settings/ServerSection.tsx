import type { FC } from 'react';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface ServerSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const ServerSection: FC<ServerSectionProps> = ({ settings, updateSetting }) => {
  const { t } = useTranslation();
  return (
    <div className='space-y-4'>
      <h3 className='border-border border-b pb-2 text-lg font-semibold'>
        {t('settings.server.title')}
      </h3>
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
};
