import { memo, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { SUPPORTED_LOCALES } from '@/config/locales';
import type { Paths, PathValue, Settings, Theme } from '@/types';

interface GeneralSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const GeneralSection: FC<GeneralSectionProps> = memo(
  ({ settings, updateSetting, theme, setTheme }) => {
    const { t } = useTranslation();
    return (
      <div className='space-y-4'>
        <h3 className='settings-section-title'>{t('settings.general.title')}</h3>

        <SettingsItem label={t('settings.general.locale')}>
          <Select
            value={settings.locale || 'zh-CN'}
            onValueChange={(val) => updateSetting(['locale'], val)}
          >
            <SelectTrigger>
              <SelectValue placeholder='Select Language' />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((loc) => (
                <SelectItem key={loc.value} value={loc.value}>
                  {loc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsItem>

        <SettingsItem label={t('settings.general.theme')}>
          <Select value={theme} onValueChange={(val) => setTheme(val as Theme)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='system'>{t('settings.general.theme_system')}</SelectItem>
              <SelectItem value='light'>{t('settings.general.theme_light')}</SelectItem>
              <SelectItem value='dark'>{t('settings.general.theme_dark')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        <SettingsItem label={t('settings.general.log_level')}>
          <Select
            value={settings.log_level}
            onValueChange={(val) => updateSetting(['log_level'], val)}
          >
            <SelectTrigger>
              <SelectValue placeholder='Select level' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='TRACE'>TRACE</SelectItem>
              <SelectItem value='DEBUG'>DEBUG</SelectItem>
              <SelectItem value='INFO'>INFO</SelectItem>
              <SelectItem value='WARNING'>WARNING</SelectItem>
              <SelectItem value='ERROR'>ERROR</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>
      </div>
    );
  },
);

GeneralSection.displayName = 'GeneralSection';
