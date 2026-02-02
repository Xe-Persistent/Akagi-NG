import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './button';
import { Modal, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from './modal';

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
}

export const ConfirmationDialog: FC<ConfirmationDialogProps> = memo(
  ({
    open,
    onOpenChange,
    title,
    description,
    onConfirm,
    confirmText,
    cancelText,
    variant = 'default',
  }) => {
    const { t } = useTranslation();
    const finalConfirmText = confirmText || t('common.confirm');
    const finalCancelText = cancelText || t('common.cancel');

    return (
      <Modal open={open} onOpenChange={onOpenChange} className='max-w-md'>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {finalCancelText}
          </Button>
          <Button
            variant={variant}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {finalConfirmText}
          </Button>
        </ModalFooter>
      </Modal>
    );
  },
);

ConfirmationDialog.displayName = 'ConfirmationDialog';
