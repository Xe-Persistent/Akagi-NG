import { Activity, Check, KeyRound, Pencil, ShoppingCart, Ticket, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OnlinePurchaseDialog } from '@/components/settings/OnlinePurchaseDialog';
import { OnlineRedeemDialog } from '@/components/settings/OnlineRedeemDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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
import { useSettings } from '@/hooks/useSettings';
import {
  clearKeyApi,
  fetchHealthApi,
  fetchKeyInfoApi,
  fetchKeyStatusApi,
  fetchOnlineModelsApi,
  saveKeyApi,
} from '@/lib/online-api';
import type { OnlineHealth, OnlineKeyInfo, OnlineKeyStatus, OnlineModel, Settings } from '@/types';

interface ModelConfigSectionProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

/** Radix refuses an empty item value, so "let the server decide" needs a label. */
const DEFAULT_MODEL = 'server-default';

/** The UI shows the budget in seconds; the setting is milliseconds. */
const TIMEOUT_MIN_S = 0.5;
const TIMEOUT_MAX_S = 3;

/**
 * Whether the key row shows a field to type into.
 *
 * The stored key never leaves the main process, so there is nothing to display
 * in a field once one is saved: an empty box with dots painted in it would claim
 * a value the renderer does not have. A saved key therefore gets a read-only
 * summary ("ending in abcd") with an explicit replace action, and the editor
 * only appears while a key is actually being entered.
 */
export function showsKeyEditor(configured: boolean, replacing: boolean): boolean {
  return replacing || !configured;
}

/** Seconds as typed, held inside the range the service can actually honour. */
export function clampTimeoutSeconds(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(TIMEOUT_MAX_S, Math.max(TIMEOUT_MIN_S, parsed));
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

  const [keyInfo, setKeyInfo] = useState<OnlineKeyInfo | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<OnlineKeyStatus | null>(null);
  const [models, setModels] = useState<OnlineModel[]>([]);
  const [health, setHealth] = useState<OnlineHealth | null>(null);
  const [busy, setBusy] = useState<'key' | 'health' | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  /** Unknown until the first read comes back, so the panel never guesses. */
  const configured = keyInfo?.configured ?? false;
  const last4 = keyInfo?.last4 ?? '';

  /**
   * The key's plan, its limits and the models it may use. Called when the panel
   * opens and after a key changes, which is when any of it can have changed —
   * there is no separate "check" action to press.
   *
   * A stored key can stop working (expired, revoked, rate limited), and this is
   * the only place that would notice: say so instead of leaving the panel
   * looking healthy while every move quietly falls back to the local model.
   */
  const loadOnlineState = useCallback(async () => {
    let info: OnlineKeyInfo;
    try {
      info = await fetchKeyInfoApi();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
      return;
    }
    setKeyInfo(info);
    if (!info.configured) return;

    const [status, list] = await Promise.all([fetchKeyStatusApi(), fetchOnlineModelsApi()]);
    if (status.success && status.data) setKeyStatus(status.data);
    if (list.success && list.data) setModels(list.data);
    if (!status.success) setKeyError(status.error ?? '');
  }, []);

  useEffect(() => {
    if (!settings.ot.online) return;
    void loadOnlineState();
  }, [settings.ot.online, loadOnlineState]);

  const saveKey = async () => {
    setBusy('key');
    setKeyError(null);
    const result = await saveKeyApi(keyDraft);
    setBusy(null);

    if (!result.success) {
      setKeyError(result.error ?? '');
      return;
    }
    setKeyDraft('');
    setEditingKey(false);
    // The old key's models may not be granted by the new one.
    setModels([]);
    await loadOnlineState();
  };

  const clearKey = async () => {
    setKeyError(null);
    setEditingKey(false);
    setKeyDraft('');
    setKeyInfo(await clearKeyApi());
    setKeyStatus(null);
    setModels([]);
  };

  const checkHealth = async () => {
    setBusy('health');
    setHealthError(null);
    const result = await fetchHealthApi();
    setBusy(null);
    if (result.success && result.data) {
      setHealth(result.data);
    } else {
      setHealthError(result.error ?? '');
    }
  };

  const storedSeconds = settings.ot.react_timeout_ms / 1000;
  const timeoutValue = timeoutDraft ?? storedSeconds.toFixed(1);

  /** Commit on blur: a half-typed value must never become a stored setting. */
  const commitTimeout = () => {
    const seconds = clampTimeoutSeconds(timeoutValue, storedSeconds);
    setTimeoutDraft(null);
    updateSetting(['ot', 'react_timeout_ms'], Math.round(seconds * 1000));
  };

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

  const renderOnlineModelSelect = (modelKey: 'model_4p' | 'model_3p', game: '4p' | '3p') => {
    const choices = models.filter((model) => model.game === game);
    const stored = settings.ot[modelKey];
    // The chosen id outlives the key that could list it (a cleared key leaves it
    // behind), and a blank trigger would hide which model is actually selected.
    const unknown = stored !== '' && !choices.some((model) => model.id === stored);
    return (
      <Select
        value={stored || DEFAULT_MODEL}
        onValueChange={(val) => updateSetting(['ot', modelKey], val === DEFAULT_MODEL ? '' : val)}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('settings.model_config.select_model')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_MODEL}>{t('settings.ot.model_default')}</SelectItem>
          {unknown && <SelectItem value={stored}>{stored}</SelectItem>}
          {choices.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.description || model.id}
            </SelectItem>
          ))}
          {choices.length === 0 && (
            <SelectItem value='none' disabled>
              {t('settings.model_config.no_online_models')}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    );
  };

  const renderKeyEntry = () => (
    <div className='flex items-center gap-2'>
      <PasswordInput
        id='ot-api-key'
        className='flex-1'
        value={keyDraft}
        onValueChange={setKeyDraft}
        placeholder={t('settings.ot.api_key_placeholder')}
        ariaLabel={t('settings.ot.api_key')}
        disabled={busy === 'key'}
      />
      <Button
        size='icon'
        aria-label={t('common.confirm')}
        disabled={busy === 'key' || !keyDraft.trim()}
        onClick={saveKey}
      >
        <Check />
      </Button>
      {/* Nothing to go back to when no key is stored; the field is the only state. */}
      {configured && (
        <Button
          variant='ghost'
          size='icon'
          aria-label={t('common.cancel')}
          disabled={busy === 'key'}
          onClick={() => {
            setEditingKey(false);
            setKeyDraft('');
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );

  /** What is stored, and the two things that can be done to it. */
  const renderKeySummary = () => (
    <div className='border-input bg-muted/40 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5'>
      <span className='text-muted-foreground flex items-center gap-2 text-sm'>
        <KeyRound className='h-4 w-4 shrink-0' />
        {t('settings.ot.key_last4', { last4: last4 })}
      </span>
      <div className='flex items-center gap-1'>
        <Button variant='ghost' size='sm' className='gap-1.5' onClick={() => setEditingKey(true)}>
          <Pencil className='h-4 w-4' />
          {t('settings.ot.replace_key')}
        </Button>
        <Button variant='ghost' size='sm' className='text-destructive gap-1.5' onClick={clearKey}>
          <Trash2 className='h-4 w-4' />
          {t('settings.ot.clear_key')}
        </Button>
      </div>
    </div>
  );

  const renderOnlineFields = () => (
    <div className='space-y-4'>
      <SettingsItem
        label={t('settings.ot.server_url')}
        description={settings.ot.server}
        layout='row'
      >
        <div className='flex flex-col items-end gap-1'>
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              onClick={() => setRedeemOpen(true)}
            >
              <Ticket className='h-4 w-4' />
              {t('settings.ot.redeem')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              onClick={() => setPurchaseOpen(true)}
            >
              <ShoppingCart className='h-4 w-4' />
              {t('settings.ot.buy')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              disabled={busy === 'health'}
              onClick={checkHealth}
            >
              <Activity className='h-4 w-4' />
              {t('settings.ot.health')}
            </Button>
            {health && !healthError && (
              <span className='text-muted-foreground text-xs'>
                {health.workersAlive && health.status === 'ok'
                  ? t('settings.ot.health_ok', { queue: health.queueDepth })
                  : t('settings.ot.health_unavailable')}
              </span>
            )}
          </div>
          {healthError && <p className='text-destructive text-xs wrap-break-word'>{healthError}</p>}
        </div>
      </SettingsItem>

      <SettingsItem
        label={t('settings.ot.api_key')}
        description={
          showsKeyEditor(configured, editingKey)
            ? configured
              ? // Replacing: say what is stored now, so it is clear the save
                // overwrites it instead of adding a second key.
                t('settings.ot.key_replace_hint', { last4 })
              : t('settings.ot.key_not_configured')
            : // Stored and untouched: the summary below already says what is
              // there, so a "configured" line above it would only repeat itself.
              undefined
        }
      >
        {showsKeyEditor(configured, editingKey) ? renderKeyEntry() : renderKeySummary()}
        {keyError && <p className='text-destructive mt-1 text-xs wrap-break-word'>{keyError}</p>}
      </SettingsItem>

      {configured && keyStatus && (
        <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs'>
          <span>
            {t('settings.ot.plan')}: {keyStatus.plan}
          </span>
          <span>
            {t('settings.ot.expires_at')}: {keyStatus.expiresAt}
          </span>
          <span>
            {t('settings.ot.usage_today')}: {keyStatus.usageToday} / {keyStatus.rpd}
          </span>
          <span>
            {t('settings.ot.rpm')}: {keyStatus.rpm}
          </span>
          {keyStatus.topk > 0 && (
            <span>
              {t('settings.ot.topk')}: {keyStatus.topk}
            </span>
          )}
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
          <span className='text-muted-foreground text-xs'>s</span>
        </div>
      </SettingsItem>
    </div>
  );

  return (
    <div className='space-y-4'>
      <h3 className='settings-section-title'>{t('settings.model_config.title')}</h3>

      <SettingsItem
        label={t('settings.ot.enable')}
        description={
          // The switch can be on with nothing to use: say so, rather than
          // leaving a green-looking "online" that is quietly local.
          settings.ot.online && keyInfo !== null && !configured
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
          {renderOnlineFields()}
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

      <OnlineRedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        configured={configured}
        last4={last4}
        expiresAt={keyStatus?.expiresAt ?? ''}
        onStored={() => void loadOnlineState()}
      />
      <OnlinePurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        onStored={() => void loadOnlineState()}
      />
    </div>
  );
}
