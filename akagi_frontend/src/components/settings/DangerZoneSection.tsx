import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingsItem } from '@/components/ui/settings-item';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import type { Paths, PathValue, Settings } from '@/types';

interface DangerZoneSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
  busy: boolean;
  onRestoreDefaults: () => void;
}

export const DangerZoneSection: FC<DangerZoneSectionProps> = ({
  settings,
  updateSetting,
  busy,
  onRestoreDefaults,
}) => {
  const { t } = useTranslation();
  return (
    <div className='border-destructive/50 bg-destructive/5 dark:bg-destructive/10 rounded-lg border p-6'>
      <h3 className='text-destructive mb-2 flex items-center gap-2 text-lg font-bold'>
        <AlertTriangle className='h-5 w-5' />
        {t('settings.danger_zone.title')}
      </h3>
      <p className='text-muted-foreground mb-6 text-sm'>{t('settings.danger_zone.desc')}</p>

      <div className='border-border border-t pt-4'></div>

      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <div className='space-y-6'>
          <SettingsItem
            label={t('settings.model.device')}
            description={t('settings.model.device_desc')}
          >
            <Select
              value={settings.model_config.device}
              onValueChange={(val) => updateSetting(['model_config', 'device'], val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='auto'>Auto</SelectItem>
                <SelectItem value='cpu'>CPU</SelectItem>
                <SelectItem value='cuda'>CUDA</SelectItem>
              </SelectContent>
            </Select>
          </SettingsItem>

          <SettingsItem
            label={t('settings.model.temperature')}
            description={t('settings.model.temperature_desc')}
          >
            <Input
              type='number'
              step='0.1'
              min='0'
              value={settings.model_config.temperature}
              onChange={(e) =>
                updateSetting(
                  ['model_config', 'temperature'],
                  parseFloat(e.target.value) || 0,
                  true,
                )
              }
            />
          </SettingsItem>

          <div className='space-y-4 pt-2'>
            <SettingsItem
              label={t('settings.model.amp')}
              description={t('settings.model.amp_desc')}
              layout='row'
            >
              <Checkbox
                id='enable_amp'
                checked={settings.model_config.enable_amp}
                onCheckedChange={(checked) =>
                  updateSetting(['model_config', 'enable_amp'], checked === true)
                }
              />
            </SettingsItem>

            <SettingsItem
              label={t('settings.model.enable_quick_eval')}
              description={t('settings.model.enable_quick_eval_desc')}
              layout='row'
            >
              <Checkbox
                id='enable_quick_eval'
                checked={settings.model_config.enable_quick_eval}
                onCheckedChange={(val) =>
                  updateSetting(['model_config', 'enable_quick_eval'], val === true)
                }
              />
            </SettingsItem>

            <SettingsItem
              label={t('settings.model.agari_guard')}
              description={t('settings.model.agari_guard_desc')}
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

        <div className='border-border space-y-4 border-l pl-6'>
          <SettingsItem label={t('settings.model.online')}>
            <CapsuleSwitch
              checked={settings.model_config.ot.online}
              onCheckedChange={(val) => updateSetting(['model_config', 'ot', 'online'], val)}
              labelOn={t('common.enabled')}
              labelOff={t('common.disabled')}
            />
          </SettingsItem>

          {settings.model_config.ot.online && (
            <div className='animate-in fade-in slide-in-from-top-2 space-y-4 duration-300'>
              <SettingsItem label={t('settings.model.server_url')}>
                <Input
                  value={settings.model_config.ot.server}
                  onChange={(e) =>
                    updateSetting(['model_config', 'ot', 'server'], e.target.value, true)
                  }
                  placeholder='http://...'
                />
              </SettingsItem>
              <SettingsItem label={t('settings.model.api_key')}>
                <Input
                  type='password'
                  value={settings.model_config.ot.api_key}
                  onChange={(e) =>
                    updateSetting(['model_config', 'ot', 'api_key'], e.target.value, true)
                  }
                  placeholder='API Key'
                />
              </SettingsItem>
            </div>
          )}

          <div className='flex justify-start pt-4'>
            <Button
              variant='destructive'
              size='sm'
              onClick={onRestoreDefaults}
              disabled={busy}
              className='w-full sm:w-auto'
            >
              <RotateCcw className='mr-2 h-4 w-4' />
              {t('settings.restore')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
