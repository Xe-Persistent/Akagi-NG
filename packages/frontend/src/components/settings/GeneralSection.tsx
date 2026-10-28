import { useTranslation } from 'react-i18next';

import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSelect } from '@/components/ui/settings-select';
import { SUPPORTED_LOCALES } from '@/config/locales';
import type { UpdateSetting } from '@/contexts/SettingsContext';
import { useTheme } from '@/hooks/useTheme';
import type { Settings, Theme } from '@/types';

interface GeneralSectionProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

export function GeneralSection({ settings, updateSetting }: GeneralSectionProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.general.title')}</h3>

      <SettingsItem label={t('settings.general.locale')}>
        <SettingsSelect
          value={settings.locale || 'zh-CN'}
          onValueChange={(val) => updateSetting(['locale'], val)}
          placeholder={t('settings.general.select_language')}
          options={SUPPORTED_LOCALES.map((loc) => ({ value: loc.value, label: loc.label }))}
        />
      </SettingsItem>

      <SettingsItem label={t('settings.general.theme')}>
        <SettingsSelect
          value={theme}
          onValueChange={(val) => setTheme(val as Theme)}
          options={[
            { value: 'system', label: t('settings.general.theme_system') },
            { value: 'light', label: t('settings.general.theme_light') },
            { value: 'dark', label: t('settings.general.theme_dark') },
          ]}
        />
      </SettingsItem>

      <SettingsItem label={t('settings.general.log_level')}>
        <SettingsSelect
          value={settings.log_level}
          onValueChange={(val) => updateSetting(['log_level'], val)}
          placeholder={t('settings.general.select_level')}
          options={[
            { value: 'error', label: 'ERROR' },
            { value: 'warn', label: 'WARN' },
            { value: 'info', label: 'INFO' },
            { value: 'debug', label: 'DEBUG' },
          ]}
        />
      </SettingsItem>
    </div>
  );
}
