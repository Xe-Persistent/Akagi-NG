import { useTranslation } from 'react-i18next';

import { CapsuleSwitch } from '@/components/ui/capsule-switch';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSelect } from '@/components/ui/settings-select';
import { MAJSOUL_SERVERS, type MajsoulServer } from '@/config/platforms';
import type { UpdateSetting } from '@/contexts/SettingsContext';
import type { Settings } from '@/types';

interface ConnectionSectionProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

/** Mirrors `mitm.port` in `assets/settings.schema.json`. */
const PORT_MIN = 1024;
const PORT_MAX = 65535;

export function ConnectionSection({ settings, updateSetting }: ConnectionSectionProps) {
  const { t } = useTranslation();
  const portOutOfRange = settings.mitm.port < PORT_MIN || settings.mitm.port > PORT_MAX;

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.connection.title')}</h3>

      <SettingsItem label={t('settings.connection.mode')}>
        <CapsuleSwitch
          className='w-fit max-w-full'
          checked={settings.mitm.enabled}
          onCheckedChange={(val) => updateSetting(['mitm', 'enabled'], val)}
          ariaLabel={t('settings.connection.mode')}
          labelOn={t('settings.connection.mode_mitm')}
          labelOff={t('settings.connection.mode_browser')}
        />
      </SettingsItem>

      {!settings.mitm.enabled && (
        <SettingsItem label={t('settings.connection.majsoul_server')}>
          <SettingsSelect
            value={settings.majsoul_server || MAJSOUL_SERVERS.CN}
            onValueChange={(val) => updateSetting(['majsoul_server'], val as MajsoulServer)}
            options={[
              { value: MAJSOUL_SERVERS.CN, label: t('settings.connection.majsoul_servers.cn') },
              { value: MAJSOUL_SERVERS.JP, label: t('settings.connection.majsoul_servers.jp') },
              { value: MAJSOUL_SERVERS.EN, label: t('settings.connection.majsoul_servers.en') },
            ]}
          />
        </SettingsItem>
      )}

      {settings.mitm.enabled && (
        <>
          <SettingsItem label={t('settings.connection.mitm.port')}>
            <div className='space-y-1'>
              <Input
                type='number'
                min={PORT_MIN}
                max={PORT_MAX}
                aria-invalid={portOutOfRange || undefined}
                value={settings.mitm.port}
                onChange={(e) =>
                  updateSetting(['mitm', 'port'], Number.parseInt(e.target.value, 10) || 0)
                }
              />
              {/* The schema rejects anything else, and that failure would only
                  surface as a detached "save failed" toast. */}
              {portOutOfRange && (
                <p className='text-xs text-destructive'>{`${PORT_MIN}-${PORT_MAX}`}</p>
              )}
            </div>
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
}
