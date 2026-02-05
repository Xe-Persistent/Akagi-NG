import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { FC, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const VARIANT_ICONS: Record<string, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

interface StatusBarProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'error' | 'warning' | 'success' | 'info';
  icon?: LucideIcon;
}

export const StatusBar: FC<StatusBarProps> = ({
  children,
  variant = 'info',
  icon: PropIcon,
  className,
  ...props
}) => {
  const Icon = PropIcon || VARIANT_ICONS[variant];

  return (
    <div
      className={cn(
        'status-bar flex items-start gap-3',
        {
          'status-error': variant === 'error',
          'status-warning': variant === 'warning',
          'status-success': variant === 'success',
          'status-info': variant === 'info',
        },
        className,
      )}
      {...props}
    >
      {Icon && <Icon className='h-4 w-4 shrink-0' />}
      {children}
    </div>
  );
};
