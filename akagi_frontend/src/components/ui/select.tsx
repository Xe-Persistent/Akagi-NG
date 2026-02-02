import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger>;

const SelectTrigger = ({ className, children, ref, ...props }: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'border-input ring-offset-background data-placeholder:text-muted-foreground focus:ring-ring flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className='h-4 w-4 opacity-50' />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

type SelectScrollUpButtonProps = ComponentProps<typeof SelectPrimitive.ScrollUpButton>;

const SelectScrollUpButton = ({ className, ref, ...props }: SelectScrollUpButtonProps) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className='h-4 w-4' />
  </SelectPrimitive.ScrollUpButton>
);
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

type SelectScrollDownButtonProps = ComponentProps<typeof SelectPrimitive.ScrollDownButton>;

const SelectScrollDownButton = ({ className, ref, ...props }: SelectScrollDownButtonProps) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className='h-4 w-4' />
  </SelectPrimitive.ScrollDownButton>
);
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

type SelectContentProps = ComponentProps<typeof SelectPrimitive.Content>;

const SelectContent = ({
  className,
  children,
  position = 'popper',
  ref,
  ...props
}: SelectContentProps) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'text-popover-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-97 ease-premium relative z-50 max-h-[--radix-select-content-available-height] min-w-32 origin-[--radix-select-content-transform-origin] overflow-x-hidden overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg duration-500 dark:border-white/10 dark:bg-zinc-950',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-2 data-[side=left]:-translate-x-2 data-[side=right]:translate-x-2 data-[side=top]:-translate-y-2',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

type SelectLabelProps = ComponentProps<typeof SelectPrimitive.Label>;

const SelectLabel = ({ className, ref, ...props }: SelectLabelProps) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-sm font-semibold', className)}
    {...props}
  />
);
SelectLabel.displayName = SelectPrimitive.Label.displayName;

type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item>;

const SelectItem = ({ className, children, ref, ...props }: SelectItemProps) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span className='absolute right-2 flex h-3.5 w-3.5 items-center justify-center'>
      <SelectPrimitive.ItemIndicator>
        <Check className='h-4 w-4' />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
);
SelectItem.displayName = SelectPrimitive.Item.displayName;

type SelectSeparatorProps = ComponentProps<typeof SelectPrimitive.Separator>;

const SelectSeparator = ({ className, ref, ...props }: SelectSeparatorProps) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('bg-muted -mx-1 my-1 h-px', className)}
    {...props}
  />
);
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
