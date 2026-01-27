import { X } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { useEffect } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export const Modal: FC<ModalProps> = ({ open, onOpenChange, children, className }) => {
  // 模态框打开时禁止页面滚动 + Escape 键监听
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onOpenChange(false);
        }
      };
      document.addEventListener('keydown', handleEscape);

      return () => {
        document.body.style.overflow = 'unset';
        document.removeEventListener('keydown', handleEscape);
      };
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className='animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm duration-200'
      role='button'
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onOpenChange(false);
        }
      }}
    >
      <div
        role='dialog'
        aria-modal='true'
        tabIndex={-1}
        className={cn(
          'bg-background border-border animate-in zoom-in-95 relative flex max-h-[90vh] w-full flex-col rounded-lg border shadow-lg duration-200',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
};

interface ModalHeaderProps {
  children: ReactNode;
  className?: string;
}

export const ModalHeader: FC<ModalHeaderProps> = ({ children, className }) => (
  <div className={cn('border-border flex flex-col space-y-1.5 border-b p-6', className)}>
    {children}
  </div>
);

interface ModalTitleProps {
  children: ReactNode;
  className?: string;
}

export const ModalTitle: FC<ModalTitleProps> = ({ children, className }) => (
  <h3 className={cn('text-lg leading-none font-semibold tracking-tight', className)}>{children}</h3>
);

interface ModalDescriptionProps {
  children: ReactNode;
  className?: string;
}

export const ModalDescription: FC<ModalDescriptionProps> = ({ children, className }) => (
  <p className={cn('text-muted-foreground text-sm', className)}>{children}</p>
);

interface ModalContentProps {
  children: ReactNode;
  className?: string;
}

export const ModalContent: FC<ModalContentProps> = ({ children, className }) => (
  <div className={cn('flex-1 overflow-y-auto p-6', className)}>{children}</div>
);

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export const ModalFooter: FC<ModalFooterProps> = ({ children, className }) => (
  <div className={cn('border-border flex items-center justify-end gap-2 border-t p-6', className)}>
    {children}
  </div>
);

interface ModalCloseProps {
  onClick: () => void;
  className?: string;
}

export const ModalClose: FC<ModalCloseProps> = ({ onClick, className }) => (
  <Button
    variant='ghost'
    size='icon'
    className={cn(
      'ring-offset-background data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 h-4 w-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none',
      className,
    )}
    onClick={onClick}
  >
    <X className='h-4 w-4' />
    <span className='sr-only'>Close</span>
  </Button>
);
