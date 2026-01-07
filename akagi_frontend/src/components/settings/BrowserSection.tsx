import type { FC } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface BrowserSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const BrowserSection: FC<BrowserSectionProps> = ({ settings, updateSetting }) => {
  const { t } = useTranslation();
  return (
    <div className='space-y-4'>
      <h3 className='border-border border-b pb-2 text-lg font-semibold'>
        {t('settings.browser.title')}
      </h3>

      <SettingsItem label={t('settings.browser.size')}>
        <Select
          value={settings.browser.window_size || 'default'}
          onValueChange={(val) =>
            updateSetting(['browser', 'window_size'], val === 'default' ? '' : val)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t('settings.browser.size_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='default'>{t('settings.browser.size_default')}</SelectItem>
            <SelectItem value='maximized'>{t('settings.browser.size_maximized')}</SelectItem>
            <SelectItem value='1280,720'>1280x720</SelectItem>
            <SelectItem value='1920,1080'>1920x1080</SelectItem>
            <SelectItem value='2560,1440'>2560x1440</SelectItem>
            <SelectItem value='3840,2160'>3840x2160</SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        label={t('settings.browser.headless')}
        description={t('settings.browser.headless_desc')}
      >
        <CapsuleSwitch
          checked={settings.browser.headless}
          onCheckedChange={(val) => updateSetting(['browser', 'headless'], val)}
          labelOn={t('common.enabled')}
          labelOff={t('common.disabled')}
        />
      </SettingsItem>
    </div>
  );
};
