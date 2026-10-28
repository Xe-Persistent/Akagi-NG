import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'focus-ring inline-flex items-center justify-center gap-2 rounded-2 text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        /** The low-emphasis step: filled, but with the muted surface rather than
         * the primary colour, so it reads as secondary to a solid button.
         */
        soft: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        /** A panel: filled with the background colour and edged, without a shadow. */
        surface: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        /** Border, fill and a shadow: the heaviest step that is not solid. */
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 24 / 32 / 36 / 40px.
        '1': 'h-6 px-2 text-xs',
        '2': 'h-8 px-3 text-xs',
        '3': 'h-9 px-4 text-sm',
        '4': 'h-10 px-8 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: '3',
    },
  },
);
