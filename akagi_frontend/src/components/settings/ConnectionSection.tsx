import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface ConnectionSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const ConnectionSection: FC<ConnectionSectionProps> = memo(({ settings, updateSetting }) => {
  const { t } = useTranslation();

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.connection.title')}</h3>

      <SettingsItem label={t('settings.connection.mode')}>
        <CapsuleSwitch
          className='w-fit max-w-full'
          checked={settings.mitm.enabled}
          onCheckedChange={(val) => {
            updateSetting(['mitm', 'enabled'], val);
          }}
          labelOn={t('settings.connection.mode_mitm')}
          labelOff={t('settings.connection.mode_browser')}
        />
      </SettingsItem>

      {['riichi_city', 'amatsuki'].includes(settings.platform) && !settings.mitm.enabled && (
        <div className='flex items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
          {t('settings.connection.mitm_required_notice')}
        </div>
      )}

      {settings.mitm.enabled && (
        <div className='mt-6 space-y-4'>
          <h4 className='text-sm font-semibold tracking-wider text-zinc-500'>
            {t('settings.connection.mitm.title')}
          </h4>

          <SettingsItem label={t('settings.connection.mitm.host')}>
            <Input
              value={settings.mitm.host}
              onChange={(e) => updateSetting(['mitm', 'host'], e.target.value)}
            />
          </SettingsItem>
          <SettingsItem label={t('settings.connection.mitm.port')}>
            <Input
              type='number'
              value={settings.mitm.port}
              onChange={(e) => updateSetting(['mitm', 'port'], parseInt(e.target.value) || 0)}
            />
          </SettingsItem>
          <SettingsItem label={t('settings.connection.mitm.upstream')}>
            <Input
              value={settings.mitm.upstream}
              placeholder='http://127.0.0.1:7890'
              onChange={(e) => updateSetting(['mitm', 'upstream'], e.target.value)}
            />
          </SettingsItem>
        </div>
      )}
    </div>
  );
});

ConnectionSection.displayName = 'ConnectionSection';
