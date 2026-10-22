import { Check, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { SettingsItem } from '@/components/ui/settings-item';

interface ApiKeyItemProps {
  configured: boolean;
  last4: string;
  busy: boolean;
  error: string | null;
  onSave: (draft: string) => Promise<boolean>;
  onClear: () => void;
}

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

/** The stored key: what it is, and the two things that can be done to it. */
export function ApiKeyItem({ configured, last4, busy, error, onSave, onClear }: ApiKeyItemProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const save = async () => {
    if (await onSave(draft)) {
      setDraft('');
      setEditing(false);
    }
  };

  const clear = () => {
    setConfirmClearOpen(false);
    setDraft('');
    setEditing(false);
    onClear();
  };

  const renderEditor = () => (
    <div className='flex items-center gap-2'>
      <PasswordInput
        id='ot-api-key'
        className='flex-1'
        value={draft}
        onValueChange={setDraft}
        placeholder={t('settings.ot.api_key_placeholder')}
        ariaLabel={t('settings.ot.api_key')}
        disabled={busy}
      />
      <Button
        size='icon'
        aria-label={t('common.confirm')}
        disabled={busy || !draft.trim()}
        onClick={() => void save()}
      >
        <Check />
      </Button>
      {/* Nothing to go back to when no key is stored; the field is the only state. */}
      {configured && (
        <Button
          variant='ghost'
          size='icon'
          aria-label={t('common.cancel')}
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDraft('');
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );

  const renderSummary = () => (
    <div className='flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-1.5'>
      <span className='flex items-center gap-2 text-sm text-muted-foreground'>
        <KeyRound className='h-4 w-4 shrink-0' />
        {t('settings.ot.key_last4', { last4 })}
      </span>
      <div className='flex items-center gap-1'>
        <Button variant='ghost' size='sm' className='gap-1.5' onClick={() => setEditing(true)}>
          <Pencil className='h-4 w-4' />
          {t('settings.ot.replace_key')}
        </Button>
        <Button
          variant='ghost'
          size='sm'
          className='gap-1.5 text-destructive'
          onClick={() => setConfirmClearOpen(true)}
        >
          <Trash2 className='h-4 w-4' />
          {t('settings.ot.clear_key')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <SettingsItem
        label={t('settings.ot.api_key')}
        description={
          showsKeyEditor(configured, editing)
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
        {showsKeyEditor(configured, editing) ? renderEditor() : renderSummary()}
        {error && <p className='mt-1 text-xs wrap-break-word text-destructive'>{error}</p>}
      </SettingsItem>

      {/* Asked before the key goes: it is encrypted, so it cannot be recovered. */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.ot.clear_key_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.ot.clear_key_confirm_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={clear}>
              {t('settings.ot.clear_key')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
