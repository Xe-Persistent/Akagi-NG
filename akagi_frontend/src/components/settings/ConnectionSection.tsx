import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { PLATFORM_DEFAULTS, PLATFORMS } from '@/config/platforms';
import type { Paths, PathValue, Settings } from '@/types';

interface ConnectionSectionProps {
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

export const ConnectionSection: FC<ConnectionSectionProps> = memo(
  ({ settings, updateSetting, updateSettingsBatch }) => {
    const { t } = useTranslation();

    return (
      <div className='space-y-4'>
        <h3 className='settings-section-title'>{t('settings.connection.title')}</h3>

        <SettingsItem label={t('settings.connection.mode')}>
          <CapsuleSwitch
            className='w-48'
            checked={settings.mitm.enabled}
            onCheckedChange={(val) => {
              updateSettingsBatch([
                { path: ['mitm', 'enabled'], value: val },
                { path: ['browser', 'enabled'], value: !val },
              ]);
            }}
            labelOn={t('settings.connection.mode_mitm')}
            labelOff={t('settings.connection.mode_browser')}
          />
        </SettingsItem>

        {!settings.mitm.enabled ? (
          <>
            <SettingsItem label={t('settings.connection.platform.label')}>
              <Select
                value={settings.browser.platform || PLATFORMS.MAJSOUL}
                onValueChange={(val) => {
                  const defaultUrl =
                    PLATFORM_DEFAULTS[val]?.url || PLATFORM_DEFAULTS[PLATFORMS.MAJSOUL].url;
                  updateSettingsBatch([
                    { path: ['browser', 'platform'], value: val },
                    { path: ['browser', 'url'], value: defaultUrl },
                  ]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select Platform' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='majsoul'>
                    {t('settings.connection.platform.majsoul')}
                  </SelectItem>
                  <SelectItem value='tenhou'>{t('settings.connection.platform.tenhou')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsItem>

            <SettingsItem label={t('settings.connection.browser.size')}>
              <Select
                value={settings.browser.window_size || 'default'}
                onValueChange={(val) =>
                  updateSetting(['browser', 'window_size'], val === 'default' ? '' : val)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('settings.connection.browser.size_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='default'>
                    {t('settings.connection.browser.size_default')}
                  </SelectItem>
                  <SelectItem value='maximized'>
                    {t('settings.connection.browser.size_maximized')}
                  </SelectItem>
                  <SelectItem value='1280,720'>1280x720</SelectItem>
                  <SelectItem value='1920,1080'>1920x1080</SelectItem>
                  <SelectItem value='2560,1440'>2560x1440</SelectItem>
                  <SelectItem value='3840,2160'>3840x2160</SelectItem>
                </SelectContent>
              </Select>
            </SettingsItem>

            <SettingsItem
              label={t('settings.connection.browser.url')}
              description={t('settings.connection.browser.url_desc')}
            >
              <Input
                value={settings.browser.url}
                placeholder={
                  settings.browser.platform === 'tenhou'
                    ? 'https://tenhou.net/3/'
                    : 'https://game.maj-soul.com/1/'
                }
                onChange={(e) => updateSetting(['browser', 'url'], e.target.value)}
              />
            </SettingsItem>

            <SettingsItem
              label={t('settings.connection.browser.headless')}
              description={t('settings.connection.browser.headless_desc')}
            >
              <CapsuleSwitch
                checked={settings.browser.headless}
                onCheckedChange={(val) => updateSetting(['browser', 'headless'], val)}
                labelOn={t('common.enabled')}
                labelOff={t('common.disabled')}
              />
            </SettingsItem>
          </>
        ) : (
          <>
            <SettingsItem label={t('settings.connection.platform.label')}>
              <Select
                value={settings.mitm.platform || 'majsoul'}
                onValueChange={(val) => updateSetting(['mitm', 'platform'], val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select Platform' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='majsoul'>
                    {t('settings.connection.platform.majsoul')}
                  </SelectItem>
                  <SelectItem value='tenhou'>{t('settings.connection.platform.tenhou')}</SelectItem>
                  <SelectItem value='riichi_city'>
                    {t('settings.connection.platform.riichi_city')}
                  </SelectItem>
                  <SelectItem value='amatsuki'>
                    {t('settings.connection.platform.amatsuki')}
                  </SelectItem>
                  <SelectItem value='auto'>{t('settings.connection.platform.auto')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsItem>

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
          </>
        )}
      </div>
    );
  },
);

ConnectionSection.displayName = 'ConnectionSection';
