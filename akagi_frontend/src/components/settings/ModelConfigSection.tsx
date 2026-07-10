import { Activity, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Slider } from '@/components/ui/slider';
import {
  checkCloudHealth,
  checkCloudKey,
  fetchCloudModels,
  useSettings,
} from '@/hooks/useSettings';
import type { ApiHealth, ApiKeyStatus, ApiModelInfo, Paths, PathValue, Settings } from '@/types';

interface ModelConfigSectionProps {
  settings: Settings;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
}

export function ModelConfigSection({ settings, updateSetting }: ModelConfigSectionProps) {
  const { t } = useTranslation();
  const { availableModels } = useSettings();
  const [tempInput, setTempInput] = useState(settings.model_config.temperature.toString());
  const [isEditingTemp, setIsEditingTemp] = useState(false);
  const displayTemp = isEditingTemp ? tempInput : settings.model_config.temperature.toString();
  const [cloudModels, setCloudModels] = useState<ApiModelInfo[]>([]);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'health' | 'key' | 'models' | null>(null);

  const apiReady = settings.api.base_url.trim() !== '' && settings.api.key.trim() !== '';

  const runApiAction = async <T,>(kind: 'health' | 'key' | 'models', action: () => Promise<T>) => {
    setBusy(kind);
    setApiError(null);
    try {
      return await action();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const loadCloudModels = async () => {
    const models = await runApiAction('models', () =>
      fetchCloudModels(settings.api.base_url, settings.api.key),
    );
    if (models) {
      setCloudModels(models);
      const model4p = models.find((model) => model.game === '4p');
      const model3p = models.find((model) => model.game === '3p');
      if (!settings.api.model_4p && model4p) updateSetting(['api', 'model_4p'], model4p.id);
      if (!settings.api.model_3p && model3p) updateSetting(['api', 'model_3p'], model3p.id);
    }
  };

  const toggleCloudApi = (enabled: boolean) => {
    updateSetting(['api', 'enabled'], enabled);
    if (enabled && apiReady) void loadCloudModels();
  };

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.model_config.title')}</h3>

      <div className='grid grid-cols-2 gap-6'>
        {/* Left Column: Engine & Model Selection */}
        <div className='space-y-4'>
          <SettingsItem label={t('settings.model_config.mode_selection')}>
            <CapsuleSwitch
              checked={settings.api.enabled}
              onCheckedChange={toggleCloudApi}
              labelOn={t('settings.model_config.online_mode')}
              labelOff={t('settings.model_config.local_mode')}
            />
          </SettingsItem>

          {settings.api.enabled ? (
            <>
              <SettingsItem label={t('settings.model_config.server_url')}>
                <Input
                  className={
                    !settings.api.base_url
                      ? 'border-destructive focus-visible:ring-destructive'
                      : ''
                  }
                  value={settings.api.base_url}
                  onChange={(e) => updateSetting(['api', 'base_url'], e.target.value)}
                  placeholder='https://mjapi.shinkuan.me'
                />
              </SettingsItem>
              <SettingsItem label={t('settings.model_config.api_key')}>
                <Input
                  type='password'
                  className={
                    !settings.api.key ? 'border-destructive focus-visible:ring-destructive' : ''
                  }
                  value={settings.api.key}
                  onChange={(e) => updateSetting(['api', 'key'], e.target.value)}
                  placeholder='<YOUR_API_KEY>'
                />
              </SettingsItem>
              <SettingsItem label={t('settings.model_config.api_model_4p')}>
                <Input
                  value={settings.api.model_4p}
                  onChange={(e) => updateSetting(['api', 'model_4p'], e.target.value)}
                  placeholder={t('settings.model_config.server_default')}
                />
              </SettingsItem>
              <SettingsItem label={t('settings.model_config.api_model_3p')}>
                <Input
                  value={settings.api.model_3p}
                  onChange={(e) => updateSetting(['api', 'model_3p'], e.target.value)}
                  placeholder={t('settings.model_config.server_default')}
                />
              </SettingsItem>

              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy !== null || !settings.api.base_url}
                  onClick={async () => {
                    const result = await runApiAction('health', () =>
                      checkCloudHealth(settings.api.base_url),
                    );
                    if (result) setHealth(result);
                  }}
                >
                  <Activity className={busy === 'health' ? 'animate-spin' : ''} />
                  {t('settings.model_config.check_health')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy !== null || !apiReady}
                  onClick={async () => {
                    const result = await runApiAction('key', () =>
                      checkCloudKey(settings.api.base_url, settings.api.key),
                    );
                    if (result) setKeyStatus(result);
                  }}
                >
                  <KeyRound className={busy === 'key' ? 'animate-spin' : ''} />
                  {t('settings.model_config.check_key')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy !== null || !apiReady}
                  onClick={loadCloudModels}
                >
                  <RefreshCw className={busy === 'models' ? 'animate-spin' : ''} />
                  {t('settings.model_config.fetch_api_models')}
                </Button>
              </div>

              {cloudModels.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {cloudModels.map((model) => (
                    <Button
                      key={model.id}
                      type='button'
                      variant='secondary'
                      size='sm'
                      title={model.desc}
                      onClick={() =>
                        updateSetting(
                          ['api', model.game === '3p' ? 'model_3p' : 'model_4p'],
                          model.id,
                        )
                      }
                    >
                      {model.game.toUpperCase()} · {model.id}
                    </Button>
                  ))}
                </div>
              )}

              {health && (
                <Alert variant='success'>
                  <Activity />
                  <AlertTitle>{t('settings.model_config.health_ok')}</AlertTitle>
                  <AlertDescription>
                    {health.status} · {health.models.join(', ') || '—'}
                  </AlertDescription>
                </Alert>
              )}

              {keyStatus && (
                <Alert variant='info'>
                  <KeyRound />
                  <AlertTitle>{t('settings.model_config.key_ok')}</AlertTitle>
                  <AlertDescription>
                    {keyStatus.plan || '—'} · {keyStatus.usage_today}/{keyStatus.rpd} · RPM{' '}
                    {keyStatus.rpm} · Top-K {keyStatus.topk} · {keyStatus.expires_at || '—'}
                  </AlertDescription>
                </Alert>
              )}

              {apiError && (
                <Alert variant='error'>
                  <AlertTitle>{t('settings.model_config.api_error')}</AlertTitle>
                  <AlertDescription>{apiError}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Right Column: Shared Model Parameters */}
        <div className='space-y-4'>
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
                value={displayTemp}
                onFocus={() => {
                  setIsEditingTemp(true);
                  setTempInput(settings.model_config.temperature.toString());
                }}
                onChange={(e) => setTempInput(e.target.value)}
                onBlur={() => {
                  setIsEditingTemp(false);
                  let val = parseFloat(tempInput);
                  if (isNaN(val)) {
                    return;
                  }
                  val = Math.max(0.1, Math.min(1.3, val));
                  updateSetting(['model_config', 'temperature'], val, true);
                  setTempInput(val.toString());
                }}
              />
            </div>
          </SettingsItem>
        </div>
      </div>
    </div>
  );
}
