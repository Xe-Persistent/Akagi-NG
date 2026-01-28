import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface OnlineModelSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const OnlineModelSection: FC<OnlineModelSectionProps> = memo(
  ({ settings, updateSetting }) => {
    const { t } = useTranslation();
    return (
      <div className='space-y-4'>
        <h3 className='settings-section-title'>{t('settings.online_model.title')}</h3>

        <CapsuleSwitch
          checked={settings.ot.online}
          onCheckedChange={(val) => updateSetting(['ot', 'online'], val)}
          labelOn={t('common.enabled')}
          labelOff={t('common.disabled')}
        />

        {settings.ot.online && (
          <div className='animate-in fade-in slide-in-from-top-2 grid grid-cols-2 gap-4 duration-300'>
            <SettingsItem label={t('settings.online_model.server_url')}>
              <Input
                value={settings.ot.server}
                onChange={(e) => updateSetting(['ot', 'server'], e.target.value, true)}
                placeholder='http://...'
              />
            </SettingsItem>
            <SettingsItem label={t('settings.online_model.api_key')}>
              <Input
                type='password'
                value={settings.ot.api_key}
                onChange={(e) => updateSetting(['ot', 'api_key'], e.target.value, true)}
                placeholder='API Key'
              />
            </SettingsItem>
          </div>
        )}
      </div>
    );
  },
);

OnlineModelSection.displayName = 'OnlineModelSection';
