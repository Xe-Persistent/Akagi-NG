import React, {useEffect} from 'react';
import {cn} from '@/lib/utils';
import {X} from 'lucide-react';
import {Button} from './button';

interface ModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
    className?: string;
}

export const Modal: React.FC<ModalProps> = ({open, children, className}) => {
    // Prevent body scroll when modal is open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className={cn(
                    "bg-background border border-border rounded-lg shadow-lg w-full relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]",
                    className
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
};

interface ModalHeaderProps {
    children: React.ReactNode;
    className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({children, className}) => (
    <div className={cn("p-6 border-b border-border flex flex-col space-y-1.5", className)}>
        {children}
    </div>
);

interface ModalTitleProps {
    children: React.ReactNode;
    className?: string;
}

export const ModalTitle: React.FC<ModalTitleProps> = ({children, className}) => (
    <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
        {children}
    </h3>
);

interface ModalDescriptionProps {
    children: React.ReactNode;
    className?: string;
}

export const ModalDescription: React.FC<ModalDescriptionProps> = ({children, className}) => (
    <p className={cn("text-sm text-muted-foreground", className)}>
        {children}
    </p>
);

interface ModalContentProps {
    children: React.ReactNode;
    className?: string;
}

export const ModalContent: React.FC<ModalContentProps> = ({children, className}) => (
    <div className={cn("p-6 flex-1 overflow-y-auto", className)}>
        {children}
    </div>
);

interface ModalFooterProps {
    children: React.ReactNode;
    className?: string;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({children, className}) => (
    <div className={cn("p-6 border-t border-border flex items-center justify-end gap-2", className)}>
        {children}
    </div>
);

interface ModalCloseProps {
    onClick: () => void;
    className?: string;
}

export const ModalClose: React.FC<ModalCloseProps> = ({onClick, className}) => (
    <Button
        variant="ghost"
        size="icon"
        className={cn("absolute right-4 top-4 h-4 w-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground", className)}
        onClick={onClick}
    >
        <X className="h-4 w-4"/>
        <span className="sr-only">Close</span>
    </Button>
);
