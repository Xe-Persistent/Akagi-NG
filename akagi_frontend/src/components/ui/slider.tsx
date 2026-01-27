import * as SliderPrimitive from '@radix-ui/react-slider';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const Slider = ({
  className,
  ref,
  markers = [],
  ...props
}: ComponentProps<typeof SliderPrimitive.Root> & { markers?: number[] }) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none items-center select-none', className)}
    {...props}
  >
    <SliderPrimitive.Track className='bg-muted relative h-2 w-full grow overflow-hidden rounded-full'>
      <SliderPrimitive.Range className='bg-primary absolute h-full' />
      {markers.map((mark, i) => (
        <div
          key={i}
          className='bg-foreground/30 absolute top-0 bottom-0 w-0.5'
          style={{ left: `${mark}%` }}
        />
      ))}
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className='border-primary ring-offset-background focus-visible:ring-ring bg-background block h-5 w-5 rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50' />
  </SliderPrimitive.Root>
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
