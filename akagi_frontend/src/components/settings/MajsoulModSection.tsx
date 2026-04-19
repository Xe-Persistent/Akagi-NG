import { type FC, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import { fetchJson } from '@/lib/api-client';
import { notify } from '@/lib/notify';
import type { MajsoulModSettings } from '@/types';

async function fetchMajsoulModSettingsApi(): Promise<MajsoulModSettings> {
  return fetchJson<MajsoulModSettings>('/api/majsoul-mod-settings');
}

async function saveMajsoulModSettingsApi(
  settings: MajsoulModSettings,
): Promise<MajsoulModSettings> {
  return fetchJson<MajsoulModSettings>('/api/majsoul-mod-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

async function resetMajsoulModSettingsApi(): Promise<MajsoulModSettings> {
  return fetchJson<MajsoulModSettings>('/api/majsoul-mod-settings/reset', { method: 'POST' });
}

interface Props {
  open: boolean;
}

export const MajsoulModSection: FC<Props> = memo(({ open }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MajsoulModSettings | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchMajsoulModSettingsApi()
      .then(setSettings)
      .catch((error) => {
        console.error('Failed to fetch Majsoul mod settings:', error);
        notify.error(t('settings.majsoul_mod.load_error'));
      });
  }, [open, t]);

  const save = async (next: MajsoulModSettings) => {
    setSettings(next);
    try {
      await saveMajsoulModSettingsApi(next);
      notify.success(t('settings.majsoul_mod.saved'));
    } catch (error) {
      console.error('Failed to save Majsoul mod settings:', error);
      notify.error(t('settings.majsoul_mod.save_error'));
    }
  };

  const update = <K extends keyof MajsoulModSettings['config']>(
    key: K,
    value: MajsoulModSettings['config'][K],
  ): void => {
    if (!settings) return;
    void save({
      ...settings,
      config: {
        ...settings.config,
        [key]: value,
      },
    });
  };

  const updateRoot = <K extends keyof MajsoulModSettings>(
    key: K,
    value: MajsoulModSettings[K],
  ): void => {
    if (!settings) return;
    void save({
      ...settings,
      [key]: value,
    });
  };

  if (!settings) return null;

  return (
    <div className='space-y-4 rounded-2xl border border-white/8 p-5'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h3 className='settings-section-title'>{t('settings.majsoul_mod.title')}</h3>
          <p className='text-muted-foreground text-xs'>{t('settings.majsoul_mod.description')}</p>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            resetMajsoulModSettingsApi()
              .then(setSettings)
              .then(() => notify.success(t('settings.majsoul_mod.reset_success')))
              .catch((error) => {
                console.error('Failed to reset Majsoul mod settings:', error);
                notify.error(t('settings.majsoul_mod.reset_error'));
              });
          }}
        >
          {t('settings.majsoul_mod.reset')}
        </Button>
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <SettingsItem label={t('settings.majsoul_mod.enable_mod')} layout='row'>
          <CapsuleSwitch
            checked={settings.enabled}
            onCheckedChange={(checked) => updateRoot('enabled', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.safe_mode')}
          layout='row'
          description={t('settings.majsoul_mod.safe_mode_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.safe_mode}
            onCheckedChange={(checked) => update('safe_mode', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.nickname')}
          description={t('settings.majsoul_mod.nickname_desc')}
        >
          <Input
            value={settings.config.nickname}
            onChange={(e) => update('nickname', e.target.value)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.show_server_prefix')}
          layout='row'
          description={t('settings.majsoul_mod.show_server_prefix_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.show_server}
            onCheckedChange={(checked) => update('show_server', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.emoji_unlock')}
          layout='row'
          description={t('settings.majsoul_mod.emoji_unlock_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.emoji}
            onCheckedChange={(checked) => update('emoji', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.anti_replace_nickname')}
          layout='row'
          description={t('settings.majsoul_mod.anti_replace_nickname_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.anti_replace_nickname}
            onCheckedChange={(checked) => update('anti_replace_nickname', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.convenience_hint')}
          layout='row'
          description={t('settings.majsoul_mod.convenience_hint_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.bianjietishi}
            onCheckedChange={(checked) => update('bianjietishi', checked)}
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.auto_update_resource')}
          layout='row'
          description={t('settings.majsoul_mod.auto_update_resource_desc')}
        >
          <CapsuleSwitch
            checked={settings.resource.auto_update}
            onCheckedChange={(checked) =>
              updateRoot('resource', { ...settings.resource, auto_update: checked })
            }
          />
        </SettingsItem>
        <SettingsItem
          label={t('settings.majsoul_mod.random_character_enabled')}
          layout='row'
          description={t('settings.majsoul_mod.random_character_enabled_desc')}
        >
          <CapsuleSwitch
            checked={settings.config.random_character.enabled}
            onCheckedChange={(checked) =>
              update('random_character', { ...settings.config.random_character, enabled: checked })
            }
          />
        </SettingsItem>
      </div>
    </div>
  );
});

MajsoulModSection.displayName = 'MajsoulModSection';
