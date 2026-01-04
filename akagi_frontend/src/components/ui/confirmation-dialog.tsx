import {Button} from './button';
import {Modal, ModalDescription, ModalFooter, ModalHeader, ModalTitle} from './modal';
import type {FC} from "react";

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

export const ConfirmationDialog: FC<ConfirmationDialogProps> = ({
                                                                    open,
                                                                    onOpenChange,
                                                                    title,
                                                                    description,
                                                                    onConfirm,
                                                                    confirmText = 'Confirm',
                                                                    cancelText = 'Cancel',
                                                                    variant = 'default',
                                                                }) => {
    return (
        <Modal open={open} onOpenChange={onOpenChange} className="max-w-md">
            <ModalHeader>
                <ModalTitle>{title}</ModalTitle>
                <ModalDescription>{description}</ModalDescription>
            </ModalHeader>
            <ModalFooter>
                <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                >
                    {cancelText}
                </Button>
                <Button
                    variant={variant}
                    onClick={() => {
                        onConfirm();
                        onOpenChange(false);
                    }}
                >
                    {confirmText}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
