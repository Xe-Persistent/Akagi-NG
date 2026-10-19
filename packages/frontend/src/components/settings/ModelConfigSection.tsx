import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import type { UpdateSetting } from '@/contexts/SettingsContext';
import { useSettings } from '@/hooks/useSettings';
import type { Settings } from '@/types';

interface ModelConfigSectionProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

export function ModelConfigSection({ settings, updateSetting }: ModelConfigSectionProps) {
  const { t } = useTranslation();
  const { availableModels } = useSettings();

  const renderModelSelect = (modelKey: 'model_4p' | 'model_3p') => (
    <Select
      value={settings.model_config[modelKey]}
      onValueChange={(val) => updateSetting(['model_config', modelKey], val)}
    >
      <SelectTrigger>
        <SelectValue placeholder={t('settings.model_config.select_model')} />
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
  );

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.model_config.title')}</h3>

      <div className='grid grid-cols-2 gap-6'>
        <SettingsItem label={t('settings.model_config.model_4p')}>
          {renderModelSelect('model_4p')}
        </SettingsItem>
        <SettingsItem label={t('settings.model_config.model_3p')}>
          {renderModelSelect('model_3p')}
        </SettingsItem>
      </div>
    </div>
  );
}
