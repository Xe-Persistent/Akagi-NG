import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchPendingPurchaseApi, pollPurchaseApi, startPurchaseApi } from '@/lib/online-api';
import type { OnlinePurchaseStatus } from '@/types';

/** Creem's status flips within seconds of the payment; three seconds is idle enough. */
const PURCHASE_POLL_MS = 3000;

/** Product ids the server sells, with the i18n key that labels each one. */
const PRODUCTS = [
  { id: 'pro-30', labelKey: 'settings.ot.products.pro_30' },
  { id: 'pro-90', labelKey: 'settings.ot.products.pro_90' },
  { id: 'pro-monthly', labelKey: 'settings.ot.products.pro_monthly' },
  { id: 'pro-yearly', labelKey: 'settings.ot.products.pro_yearly' },
] as const;

interface OnlinePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once a key was stored, so the caller can refresh its state. */
  onStored: () => void;
}

/**
 * The Creem flow from the buyer's side: pick a product, pay in the browser that
 * the main process opens, and wait here while the checkout is polled.
 *
 * Closing the dialog does not abandon the checkout: the main process keeps the
 * claim secret for an hour, so a payment completed in the browser (or while the
 * app was closed) is collected the next time this dialog opens.
 */
export function OnlinePurchaseDialog({ open, onOpenChange, onStored }: OnlinePurchaseDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<OnlinePurchaseStatus | null>(null);
  const [resumedProduct, setResumedProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * A checkout the app opened earlier may already have been paid for. Resuming it
   * is the only way to collect that key: the claim secret lives in the main
   * process, and losing it means the buyer has to fall back to the emailed copy.
   */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void (async () => {
      const pending = await fetchPendingPurchaseApi();
      if (cancelled || !pending.success || !pending.data) return;
      setResumedProduct(pending.data.product);
      setStatus({ status: 'pending', plan: '', expiresAt: '', days: 0, stored: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const start = async (product: string) => {
    setBusy(true);
    setError(null);
    const result = await startPurchaseApi(product);
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? '');
      return;
    }
    setResumedProduct(null);
    setStatus({ status: 'pending', plan: '', expiresAt: '', days: 0, stored: false });
  };

  const onPolled = useEffectEvent((polled: OnlinePurchaseStatus) => {
    if (polled.stored) onStored();
  });

  useEffect(() => {
    if (!open || status?.status !== 'pending') return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await pollPurchaseApi();
      if (cancelled) return;
      if (!result.success || !result.data) {
        // A single failed poll is not a failed purchase: keep waiting.
        return;
      }
      setStatus(result.data);
      if (result.data.stored) onPolled(result.data);
    }, PURCHASE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, status?.status]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setStatus(null);
      setResumedProduct(null);
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  };

  /** The label for the resumed product, which names itself if this build no longer sells it. */
  const resumedLabel = (() => {
    const product = PRODUCTS.find((entry) => entry.id === resumedProduct);
    return product ? t(product.labelKey) : (resumedProduct ?? '');
  })();

  const message = (() => {
    if (!status) return null;
    switch (status.status) {
      case 'pending':
        return resumedProduct
          ? t('settings.ot.purchase_resuming', { product: resumedLabel })
          : t('settings.ot.purchase_pending');
      case 'ready':
        return status.stored ? t('settings.ot.purchase_ready') : status.message;
      case 'delivered':
        return t('settings.ot.purchase_delivered');
      case 'expired':
        return t('settings.ot.purchase_expired');
      case 'refunded':
      case 'cancelled':
      case 'suspended':
        return t('settings.ot.purchase_failed');
      default:
        return status.message ?? null;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('settings.ot.purchase_title')}</DialogTitle>
          <DialogDescription>{t('settings.ot.purchase_desc')}</DialogDescription>
        </DialogHeader>

        {status ? (
          <div className='space-y-2'>
            {message && <p className='text-sm'>{message}</p>}
            {status.expiresAt && (
              <p className='text-xs text-muted-foreground'>
                {t('settings.ot.expires_at')}: {status.expiresAt}
              </p>
            )}
          </div>
        ) : (
          <div className='space-y-2'>
            <p className='text-sm font-medium'>{t('settings.ot.purchase_choose')}</p>
            {PRODUCTS.map((product) => (
              <Button
                key={product.id}
                variant='outline'
                className='w-full justify-start'
                disabled={busy}
                onClick={() => void start(product.id)}
              >
                {t(product.labelKey)}
              </Button>
            ))}
          </div>
        )}

        {error && <p className='text-xs wrap-break-word text-destructive'>{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
