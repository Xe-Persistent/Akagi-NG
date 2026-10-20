import { useActionState, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { redeemApi } from '@/lib/online-api';

interface OnlineRedeemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether a key is already stored, i.e. whether there is one to renew. */
  configured: boolean;
  /** The stored key's last four characters and expiry, for the renewal notice. */
  last4: string;
  expiresAt: string;
  /** Called once a key was minted or extended, so the caller can refresh. */
  onStored: () => void;
}

/** What a submit attempt can end in: a stored key, or the reason it is not. */
interface RedeemState {
  /** `null` until something was redeemed; a renewal has no new key to store. */
  done: null | { extended: boolean; last4: string; until: string };
  error: string | null;
}

const INITIAL: RedeemState = { done: null, error: null };

/**
 * Exchanges a purchase code for a key — or for more time on the key already
 * stored. The main process stores the key as soon as it is minted (the service
 * hands it out once), so this dialog never sees it.
 *
 * A real `<form>` with a `useActionState` action: Enter submits, the pending
 * state comes from the action itself, and closing the dialog drops the whole
 * attempt along with the unmounted subtree.
 */
export function OnlineRedeemDialog({
  open,
  onOpenChange,
  configured,
  last4,
  expiresAt,
  onStored,
}: OnlineRedeemDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('settings.ot.redeem_title')}</DialogTitle>
          <DialogDescription>{t('settings.ot.redeem_desc')}</DialogDescription>
        </DialogHeader>

        <RedeemForm
          configured={configured}
          last4={last4}
          expiresAt={expiresAt}
          onStored={onStored}
        />
      </DialogContent>
    </Dialog>
  );
}

interface RedeemFormProps {
  configured: boolean;
  last4: string;
  expiresAt: string;
  onStored: () => void;
}

function RedeemForm({ configured, last4, expiresAt, onStored }: RedeemFormProps) {
  const { t } = useTranslation();
  // Whoever redeems a code while holding a live key almost always wants more
  // time on it, so renewal starts on; with no key stored there is nothing else
  // it could mean, and the switch is disabled.
  const [renew, setRenew] = useState(configured);
  const renewing = configured && renew;

  const [state, submit, isPending] = useActionState(
    async (_previous: RedeemState, form: FormData): Promise<RedeemState> => {
      const result = await redeemApi(
        String(form.get('code') ?? ''),
        String(form.get('email') ?? ''),
        form.get('renew') === 'on',
      );
      if (!result.success || !result.data) {
        return { done: null, error: result.error ?? '' };
      }
      const { extended, keyLast4, expiresAt: until } = result.data;
      onStored();
      return { done: { extended, last4: keyLast4, until }, error: null };
    },
    INITIAL,
  );

  if (state.done) {
    return (
      <p className='text-sm'>
        {state.done.extended
          ? t('settings.ot.redeemed_extended', { last4: state.done.last4, until: state.done.until })
          : t('settings.ot.redeem_done')}
      </p>
    );
  }

  return (
    <form action={submit} className='space-y-3'>
      <Input
        name='code'
        required
        placeholder={t('settings.ot.redeem_code')}
        aria-label={t('settings.ot.redeem_code')}
      />

      <div className='flex items-center justify-between gap-4'>
        <div className='flex flex-col gap-0.5'>
          <span className='text-sm'>{t('settings.ot.redeem_renew')}</span>
          <span className='text-muted-foreground text-xs'>
            {configured ? t('settings.ot.redeem_renew_hint') : t('settings.ot.key_not_configured')}
          </span>
        </div>
        <Switch
          name='renew'
          checked={renewing}
          disabled={!configured}
          onCheckedChange={setRenew}
          aria-label={t('settings.ot.redeem_renew')}
        />
      </div>

      {renewing && (
        <p className='text-muted-foreground text-xs'>
          {t('settings.ot.key_last4', { last4 })} · {t('settings.ot.expires_at')}: {expiresAt}
        </p>
      )}

      {/* A renewal is tied to the stored key, so a minting email does nothing. */}
      {!renewing && (
        <>
          <Input
            name='email'
            type='email'
            placeholder={t('settings.ot.redeem_email')}
            aria-label={t('settings.ot.redeem_email')}
          />
          <p className='text-muted-foreground text-xs'>{t('settings.ot.redeem_email_hint')}</p>
        </>
      )}

      {state.error && <p className='text-destructive text-xs wrap-break-word'>{state.error}</p>}
      <Button type='submit' className='w-full' disabled={isPending}>
        {t('settings.ot.redeem_submit')}
      </Button>
    </form>
  );
}
