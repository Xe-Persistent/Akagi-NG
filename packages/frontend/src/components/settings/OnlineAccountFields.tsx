import { Activity, ShoppingCart, Ticket } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiKeyItem } from '@/components/settings/ApiKeyItem';
import { OnlinePurchaseDialog } from '@/components/settings/OnlinePurchaseDialog';
import { OnlineRedeemDialog } from '@/components/settings/OnlineRedeemDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSelect } from '@/components/ui/settings-select';
import type { UpdateSetting } from '@/contexts/SettingsContext';
import type { OnlineAccount } from '@/hooks/useOnlineAccount';
import type { Settings } from '@/types';

interface OnlineAccountFieldsProps {
  settings: Settings;
  updateSetting: UpdateSetting;
  account: OnlineAccount;
}

/** Radix refuses an empty item value, so "let the server decide" needs a label. */
const DEFAULT_MODEL = 'server-default';

/** Stands in for "no models were granted" so the trigger still has something. */
const NO_MODELS = 'no-online-models';

/** Shown for a value that has not arrived (or that the server did not report). */
const UNKNOWN = '—';

/** A status value as text, or the placeholder that keeps its line in place. */
function known(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  const text = String(value);
  return text === '' ? UNKNOWN : text;
}

/** The UI shows the budget in seconds; the setting is milliseconds. */
const TIMEOUT_MIN_S = 0.5;
const TIMEOUT_MAX_S = 3;

/** Seconds as typed, held inside the range the service can actually honour. */
export function clampTimeoutSeconds(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(TIMEOUT_MAX_S, Math.max(TIMEOUT_MIN_S, parsed));
}

/** Everything that only exists while the online model is on. */
export function OnlineAccountFields({
  settings,
  updateSetting,
  account,
}: OnlineAccountFieldsProps) {
  const { t } = useTranslation();
  const { keyStatus, models, health, busy, keyError, healthError, configured, last4 } = account;
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);

  const storedSeconds = settings.ot.react_timeout_ms / 1000;
  const timeoutValue = timeoutDraft ?? storedSeconds.toFixed(1);

  /** Empty until the first check, so the row can reserve the same space always. */
  const healthSummary = health
    ? health.workersAlive && health.status === 'ok'
      ? t('settings.ot.health_ok', { queue: health.queueDepth })
      : t('settings.ot.health_unavailable')
    : '';

  /** Commit on blur: a half-typed value must never become a stored setting. */
  const commitTimeout = () => {
    const seconds = clampTimeoutSeconds(timeoutValue, storedSeconds);
    setTimeoutDraft(null);
    updateSetting(['ot', 'react_timeout_ms'], Math.round(seconds * 1000));
  };

  const renderOnlineModelSelect = (modelKey: 'model_4p' | 'model_3p', game: '4p' | '3p') => {
    const choices = models.filter((model) => model.game === game);
    // The sentinel is ours, not a model id: a file that somehow contains it is
    // read as "let the server decide" rather than added as a second default.
    const stored = settings.ot[modelKey] === DEFAULT_MODEL ? '' : settings.ot[modelKey];
    // The chosen id outlives the key that could list it (a cleared key leaves it
    // behind), and a blank trigger would hide which model is actually selected:
    // `SettingsSelect` adds a stored id it cannot find. Without any choice the
    // default stays offered, with a hint that nothing else was granted.
    const options = [
      { value: DEFAULT_MODEL, label: t('settings.ot.model_default') },
      ...choices.map((model) => ({ value: model.id, label: model.description || model.id })),
      ...(choices.length === 0
        ? [
            {
              value: NO_MODELS,
              label: t('settings.model_config.no_online_models'),
              disabled: true,
            },
          ]
        : []),
    ];

    return (
      <SettingsSelect
        value={stored || DEFAULT_MODEL}
        onValueChange={(val) => updateSetting(['ot', modelKey], val === DEFAULT_MODEL ? '' : val)}
        placeholder={t('settings.model_config.select_model')}
        options={options}
      />
    );
  };

  return (
    <div className='space-y-4'>
      <SettingsItem
        label={t('settings.ot.server_url')}
        description={settings.ot.server}
        layout='row'
      >
        <div className='flex flex-col items-end gap-1'>
          <div className='flex items-center justify-end gap-3'>
            <span
              aria-live='polite'
              title={healthSummary}
              className='min-w-0 flex-1 truncate text-right text-xs text-muted-foreground'
            >
              {healthSummary}
            </span>
            <div className='flex flex-wrap items-center justify-end gap-2'>
              <Button
                variant='outline'
                size='2'
                className='gap-1.5'
                onClick={() => setRedeemOpen(true)}
              >
                <Ticket className='h-4 w-4' />
                {t('settings.ot.redeem')}
              </Button>
              <Button
                variant='outline'
                size='2'
                className='gap-1.5'
                onClick={() => setPurchaseOpen(true)}
              >
                <ShoppingCart className='h-4 w-4' />
                {t('settings.ot.buy')}
              </Button>
              <Button
                variant='outline'
                size='2'
                className='gap-1.5'
                disabled={busy === 'health'}
                onClick={() => void account.checkHealth()}
              >
                <Activity className='h-4 w-4' />
                {t('settings.ot.health')}
              </Button>
            </div>
          </div>
          {healthError && <p className='text-xs wrap-break-word text-destructive'>{healthError}</p>}
        </div>
      </SettingsItem>

      <ApiKeyItem
        configured={configured}
        last4={last4}
        busy={busy === 'key'}
        error={keyError}
        onSave={account.saveKey}
        onClear={() => void account.clearKey()}
      />

      {configured && (
        <div className='flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground'>
          {/* The line is there from the first render, carrying `—` until the
              status arrives: the panel keeps its height instead of growing when
              the answer does, and the fields are visible before they are known. */}
          <span>
            {t('settings.ot.plan')}: {known(keyStatus?.plan)}
          </span>
          <span>
            {t('settings.ot.expires_at')}: {known(keyStatus?.expiresAt)}
          </span>
          <span>
            {t('settings.ot.usage_today')}:{' '}
            {keyStatus ? `${keyStatus.usageToday} / ${keyStatus.rpd}` : known(undefined)}
          </span>
          <span>
            {t('settings.ot.rpm')}: {known(keyStatus?.rpm)}
          </span>
          <span>
            {t('settings.ot.topk')}:{' '}
            {known(keyStatus && keyStatus.topk > 0 ? keyStatus.topk : null)}
          </span>
        </div>
      )}

      <div className='grid grid-cols-2 gap-6'>
        <SettingsItem label={t('settings.ot.model_4p')}>
          {renderOnlineModelSelect('model_4p', '4p')}
        </SettingsItem>
        <SettingsItem label={t('settings.ot.model_3p')}>
          {renderOnlineModelSelect('model_3p', '3p')}
        </SettingsItem>
      </div>

      <SettingsItem
        label={t('settings.ot.request_timeout')}
        description={t('settings.ot.request_timeout_desc')}
        layout='row'
      >
        <div className='flex items-center gap-2'>
          <Input
            type='number'
            min={TIMEOUT_MIN_S}
            max={TIMEOUT_MAX_S}
            step={0.1}
            value={timeoutValue}
            aria-label={t('settings.ot.request_timeout')}
            onChange={(event) => setTimeoutDraft(event.target.value)}
            onBlur={commitTimeout}
            className='w-24'
          />
          <span className='text-xs text-muted-foreground'>s</span>
        </div>
      </SettingsItem>

      <OnlineRedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        configured={configured}
        last4={last4}
        expiresAt={keyStatus?.expiresAt ?? ''}
        onStored={() => void account.reload()}
      />
      <OnlinePurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        onStored={() => void account.reload()}
      />
    </div>
  );
}
