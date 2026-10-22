import { useTranslation } from 'react-i18next';

import { OnlineAccountFields } from '@/components/settings/OnlineAccountFields';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SettingsItem } from '@/components/ui/settings-item';
import { Switch } from '@/components/ui/switch';
import type { UpdateSetting } from '@/contexts/SettingsContext';
import { useOnlineAccount } from '@/hooks/useOnlineAccount';
import { useSettings } from '@/hooks/useSettings';
import type { Settings } from '@/types';

interface ModelConfigSectionProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

/**
 * The model settings: one switch for the online (MJOT) model, the fields that
 * belong to it while it is on, and the local weights underneath.
 *
 * The local model is always on screen rather than swapped out by a mode toggle:
 * it is not an alternative mode, it is what answers when the online call fails,
 * and hiding it made the switch look like it replaced it.
 */
export function ModelConfigSection({ settings, updateSetting }: ModelConfigSectionProps) {
  const { t } = useTranslation();
  const { availableModels } = useSettings();
  // Held here rather than inside the fields so turning the online model off and
  // on again shows what was already read instead of an empty panel.
  const account = useOnlineAccount(settings.ot.online);

  const renderLocalModelSelect = (modelKey: 'model_4p' | 'model_3p') => {
    const stored = settings.model_config[modelKey];
    // A stored file the directory no longer lists still has to read as itself,
    // not as an empty box: the engine will try exactly that name.
    const unknown = stored !== '' && !availableModels.includes(stored);
    return (
      <Select
        value={stored}
        onValueChange={(val) => updateSetting(['model_config', modelKey], val)}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('settings.model_config.select_model')} />
        </SelectTrigger>
        <SelectContent>
          {unknown && <SelectItem value={stored}>{stored}</SelectItem>}
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
  };

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.model_config.title')}</h3>

      <SettingsItem
        label={t('settings.ot.enable')}
        description={
          // The switch can be on with nothing to use: say so, rather than
          // leaving a green-looking "online" that is quietly local.
          settings.ot.online && account.keyInfo !== null && !account.configured
            ? t('settings.ot.enable_hint_no_key')
            : t('settings.ot.enable_hint')
        }
        layout='row'
      >
        <Switch
          aria-label={t('settings.ot.enable')}
          checked={settings.ot.online}
          onCheckedChange={(online) => updateSetting(['ot', 'online'], online)}
        />
      </SettingsItem>

      {settings.ot.online && (
        <>
          <Separator />
          <OnlineAccountFields
            settings={settings}
            updateSetting={updateSetting}
            account={account}
          />
          <Separator />
        </>
      )}

      <div className='grid grid-cols-2 gap-6'>
        <SettingsItem label={t('settings.model_config.model_4p')}>
          {renderLocalModelSelect('model_4p')}
        </SettingsItem>
        <SettingsItem label={t('settings.model_config.model_3p')}>
          {renderLocalModelSelect('model_3p')}
        </SettingsItem>
      </div>
    </div>
  );
}
