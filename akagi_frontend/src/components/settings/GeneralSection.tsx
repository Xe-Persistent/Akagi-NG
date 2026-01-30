import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { SUPPORTED_LOCALES } from '@/config/locales';
import { PLATFORM_DEFAULTS, PLATFORMS } from '@/config/platforms';
import { useTheme } from '@/hooks/useTheme';
import type { Paths, PathValue, Settings, Theme } from '@/types';

interface GeneralSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
  updateSettingsBatch: (
    updates: { path: readonly string[]; value: unknown }[],
    shouldDebounce?: boolean,
  ) => void;
}

export const GeneralSection: FC<GeneralSectionProps> = memo(
  ({ settings, updateSetting, updateSettingsBatch }) => {
    const { t, i18n } = useTranslation();
    const { theme, setTheme } = useTheme();
    return (
      <div className='space-y-4'>
        <h3 className='settings-section-title'>{t('settings.general.title')}</h3>

        <SettingsItem label={t('settings.general.locale')}>
          <Select
            value={settings.locale || 'zh-CN'}
            onValueChange={(val) => {
              i18n.changeLanguage(val);
              updateSetting(['locale'], val);
            }}
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

        <SettingsItem label={t('settings.general.platform.label')}>
          <Select
            value={settings.platform || PLATFORMS.MAJSOUL}
            onValueChange={(val) => {
              const defaultUrl =
                PLATFORM_DEFAULTS[val]?.url || PLATFORM_DEFAULTS[PLATFORMS.MAJSOUL].url;
              updateSettingsBatch([
                { path: ['platform'], value: val },
                { path: ['game_url'], value: defaultUrl },
              ]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder='Select Platform' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='majsoul'>{t('settings.general.platform.majsoul')}</SelectItem>
              <SelectItem value='tenhou'>{t('settings.general.platform.tenhou')}</SelectItem>
              <SelectItem value='riichi_city'>
                {t('settings.general.platform.riichi_city')}
              </SelectItem>
              <SelectItem value='amatsuki'>{t('settings.general.platform.amatsuki')}</SelectItem>
              <SelectItem value='auto'>{t('settings.general.platform.auto')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        {['majsoul', 'tenhou', 'auto'].includes(settings.platform) && (
          <SettingsItem
            label={t('settings.general.game_url')}
            description={t('settings.general.game_url_desc')}
          >
            <Input
              value={settings.game_url}
              placeholder={
                settings.platform === 'tenhou'
                  ? 'https://tenhou.net/3/'
                  : 'https://game.maj-soul.com/1/'
              }
              onChange={(e) => updateSetting(['game_url'], e.target.value)}
            />
          </SettingsItem>
        )}
      </div>
    );
  },
);

GeneralSection.displayName = 'GeneralSection';
