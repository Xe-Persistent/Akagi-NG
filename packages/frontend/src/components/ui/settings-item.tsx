import { type HTMLAttributes, type ReactNode, useId } from 'react';

import { cn } from '@/lib/utils';

interface SettingsItemProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  layout?: 'row' | 'col';
}

export function SettingsItem({
  label,
  description,
  children,
  layout = 'col',
  className,
  ...props
}: SettingsItemProps) {
  const labelId = useId();

  return (
    <div
      role='group'
      aria-labelledby={labelId}
      className={cn(
        'group flex w-full',
        layout === 'row' ? 'items-center justify-between gap-4' : 'flex-col gap-2',
        className,
      )}
      {...props}
    >
      <div className='flex flex-col gap-0.5'>
        <span id={labelId} className='text-sm leading-none font-medium'>
          {label}
        </span>
        {description && <p className='text-xs text-muted-foreground'>{description}</p>}
      </div>
      <div className={cn(layout === 'row' ? 'shrink-0' : 'w-full')}>{children}</div>
    </div>
  );
}
