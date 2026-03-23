import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import type { Paths, PathValue, Settings } from '@/types';

interface AutoplaySectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const AutoplaySection: FC<AutoplaySectionProps> = memo(
  ({ settings, updateSetting }) => {
    const { t } = useTranslation();

    const updateNumber = <P extends Paths<Settings>>(
      path: readonly [...P],
      rawValue: string,
      parser: (value: string) => number,
    ) => {
      const next = parser(rawValue);
      if (!Number.isNaN(next)) {
        updateSetting(path, next as PathValue<Settings, P>, true);
      }
    };

    return (
      <div className='space-y-6'>
        <h3 className='settings-section-title'>{t('settings.autoplay.title')}</h3>

        <SettingsItem
          label={t('settings.autoplay.enabled')}
          description={t('settings.autoplay.enabled_desc')}
        >
          <CapsuleSwitch
            className='w-fit'
            checked={settings.autoplay.enabled}
            onCheckedChange={(value) => updateSetting(['autoplay', 'enabled'], value)}
            labelOn={t('common.enabled')}
            labelOff={t('common.disabled')}
          />
        </SettingsItem>

        <SettingsItem
          label={t('settings.autoplay.window_keyword')}
          description={t('settings.autoplay.window_keyword_desc')}
        >
          <Input
            value={settings.autoplay.window_keyword}
            placeholder='majsoul, jantama'
            onChange={(e) => updateSetting(['autoplay', 'window_keyword'], e.target.value, true)}
          />
        </SettingsItem>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <SettingsItem
            label={t('settings.autoplay.first_tile')}
            description={t('settings.autoplay.first_tile_desc')}
          >
            <Input
              type='number'
              min='0'
              step='0.1'
              value={settings.autoplay.timing.first_tile}
              onChange={(e) =>
                updateNumber(['autoplay', 'timing', 'first_tile'], e.target.value, parseFloat)
              }
            />
          </SettingsItem>

          <SettingsItem
            label={t('settings.autoplay.candidate')}
            description={t('settings.autoplay.candidate_desc')}
          >
            <Input
              type='number'
              min='0'
              step='0.05'
              value={settings.autoplay.timing.candidate}
              onChange={(e) =>
                updateNumber(['autoplay', 'timing', 'candidate'], e.target.value, parseFloat)
              }
            />
          </SettingsItem>

          <SettingsItem
            label={t('settings.autoplay.rand_min')}
            description={t('settings.autoplay.rand_min_desc')}
          >
            <Input
              type='number'
              min='0'
              step='0.05'
              value={settings.autoplay.timing.rand_min}
              onChange={(e) =>
                updateNumber(['autoplay', 'timing', 'rand_min'], e.target.value, parseFloat)
              }
            />
          </SettingsItem>

          <SettingsItem
            label={t('settings.autoplay.rand_max')}
            description={t('settings.autoplay.rand_max_desc')}
          >
            <Input
              type='number'
              min='0'
              step='0.05'
              value={settings.autoplay.timing.rand_max}
              onChange={(e) =>
                updateNumber(['autoplay', 'timing', 'rand_max'], e.target.value, parseFloat)
              }
            />
          </SettingsItem>
        </div>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <SettingsItem
            label={t('settings.autoplay.bezier_smoothing')}
            description={t('settings.autoplay.bezier_smoothing_desc')}
          >
            <Input
              type='number'
              min='0'
              max='1'
              step='0.05'
              value={settings.autoplay.input.bezier_smoothing}
              onChange={(e) =>
                updateNumber(
                  ['autoplay', 'input', 'bezier_smoothing'],
                  e.target.value,
                  parseFloat,
                )
              }
            />
          </SettingsItem>

          <SettingsItem
            label={t('settings.autoplay.bezier_steps')}
            description={t('settings.autoplay.bezier_steps_desc')}
          >
            <Input
              type='number'
              min='10'
              step='1'
              value={settings.autoplay.input.bezier_steps}
              onChange={(e) =>
                updateNumber(
                  ['autoplay', 'input', 'bezier_steps'],
                  e.target.value,
                  (value) => parseInt(value, 10),
                )
              }
            />
          </SettingsItem>
        </div>
      </div>
    );
  },
);

AutoplaySection.displayName = 'AutoplaySection';
