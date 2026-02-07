import { type FC, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { Slider } from '@/components/ui/slider';
import { useSettings } from '@/hooks/useSettings';
import type { Paths, PathValue, Settings } from '@/types';

interface ModelConfigSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export const ModelConfigSection: FC<ModelConfigSectionProps> = memo(
  ({ settings, updateSetting }) => {
    const { t } = useTranslation();
    const { availableModels } = useSettings();
    const [tempInput, setTempInput] = useState(settings.model_config.temperature.toString());
    const [prevTemp, setPrevTemp] = useState(settings.model_config.temperature);

    // Derived state: reset local state when props update
    if (settings.model_config.temperature !== prevTemp) {
      setPrevTemp(settings.model_config.temperature);
      setTempInput(settings.model_config.temperature.toString());
    }

    return (
      <div className='space-y-6'>
        <h3 className='settings-section-title'>{t('settings.model_config.title')}</h3>

        <div className='grid grid-cols-1 gap-8 md:grid-cols-2'>
          {/* Left Column: Engine & Model Selection */}
          <div className='space-y-4'>
            <SettingsItem label={t('settings.model_config.mode_selection')}>
              <CapsuleSwitch
                checked={settings.ot.online}
                onCheckedChange={(val) => updateSetting(['ot', 'online'], val)}
                labelOn={t('settings.model_config.online_mode')}
                labelOff={t('settings.model_config.local_mode')}
              />
            </SettingsItem>

            {settings.ot.online ? (
              <div className='animate-in fade-in slide-in-from-top-2 space-y-4 transition-all'>
                <div className='space-y-4'>
                  <SettingsItem label={t('settings.model_config.server_url')}>
                    <Input
                      value={settings.ot.server}
                      onChange={(e) => updateSetting(['ot', 'server'], e.target.value)}
                      placeholder='https://api.example.com'
                    />
                  </SettingsItem>
                  <SettingsItem label={t('settings.model_config.api_key')}>
                    <Input
                      type='password'
                      value={settings.ot.api_key}
                      onChange={(e) => updateSetting(['ot', 'api_key'], e.target.value)}
                      placeholder='sk-...'
                    />
                  </SettingsItem>
                </div>
              </div>
            ) : (
              <div className='animate-in fade-in slide-in-from-bottom-2 space-y-4 transition-all'>
                <SettingsItem label={t('settings.model_config.model_4p')}>
                  <Select
                    value={settings.model_config.model_4p}
                    onValueChange={(val) => updateSetting(['model_config', 'model_4p'], val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Select 4P Model' />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value='none' disabled>
                          {t('settings.model_config.no_models_found')}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </SettingsItem>

                <SettingsItem label={t('settings.model_config.model_3p')}>
                  <Select
                    value={settings.model_config.model_3p}
                    onValueChange={(val) => updateSetting(['model_config', 'model_3p'], val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Select 3P Model' />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value='none' disabled>
                          {t('settings.model_config.no_models_found')}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </SettingsItem>
              </div>
            )}
          </div>

          {/* Right Column: Shared Model Parameters */}
          <div className='space-y-6'>
            <SettingsItem
              label={t('settings.model_config.temperature')}
              description={t('settings.model_config.temperature_desc')}
            >
              <div className='flex items-center gap-4 pt-1'>
                <Slider
                  min={0}
                  max={100}
                  step={0.1}
                  value={[
                    100 *
                      (Math.log(Math.max(0.1, settings.model_config.temperature) / 0.1) /
                        Math.log(13)),
                  ]}
                  markers={[100 * (Math.log(0.3 / 0.1) / Math.log(13))]}
                  onValueChange={(val) => {
                    const temp = 0.1 * Math.pow(13, val[0] / 100);
                    const rounded = Math.round(temp * 1000) / 1000;
                    updateSetting(['model_config', 'temperature'], rounded, true);
                  }}
                  className='flex-1'
                />
                <Input
                  className='w-16 text-center tabular-nums'
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  onBlur={() => {
                    let val = parseFloat(tempInput);
                    if (isNaN(val)) {
                      setTempInput(settings.model_config.temperature.toString());
                      return;
                    }
                    val = Math.max(0.1, Math.min(1.3, val));
                    updateSetting(['model_config', 'temperature'], val, true);
                    setTempInput(val.toString());
                  }}
                />
              </div>
            </SettingsItem>

            <SettingsItem
              label={t('settings.model_config.agari_guard')}
              description={t('settings.model_config.agari_guard_desc')}
              layout='row'
            >
              <Checkbox
                id='agari_guard'
                checked={settings.model_config.rule_based_agari_guard}
                onCheckedChange={(checked) =>
                  updateSetting(['model_config', 'rule_based_agari_guard'], checked === true)
                }
              />
            </SettingsItem>
          </div>
        </div>
      </div>
    );
  },
);

ModelConfigSection.displayName = 'ModelConfigSection';
