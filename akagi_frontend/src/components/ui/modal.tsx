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
      className='fixed inset-0 z-50 flex items-center justify-center p-4'
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
      {/* 背景遮罩层 */}
      <div className='modal-backdrop' />

      {/* 对话框内容 */}
      <div role='dialog' aria-modal='true' tabIndex={-1} className={cn('modal-content', className)}>
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
      'ring-offset-background data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-3 right-3 h-8 w-8 rounded-full opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none dark:hover:bg-white/10',
      className,
    )}
    onClick={onClick}
  >
    <X className='h-5 w-5' />
    <span className='sr-only'>Close</span>
  </Button>
);
