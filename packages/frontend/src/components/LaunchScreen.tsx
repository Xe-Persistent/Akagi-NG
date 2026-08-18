import { cn } from '@/lib/utils';

export interface LaunchScreenProps {
  className?: string;
  isStatic?: boolean;
}

export function LaunchScreen({ className, isStatic = false }: LaunchScreenProps) {
  // 只有在非静态模式下才应用进场动画类
  const enterAnimation = !isStatic
    ? 'animate-in fade-in-0 slide-in-from-bottom-4 duration-1000'
    : '';

  return (
    <div
      className={cn(
        'z-splash pointer-events-none fixed inset-0 flex flex-col items-center justify-center gap-8 p-8',
        className,
      )}
    >
      {/* Logo Container with Glow Effect */}
      <div className='relative'>
        <div className='logo-glow-effect' />
        <img
          src='torii.svg'
          alt='Akagi Logo'
          className={cn(
            'relative h-32 w-32 drop-shadow-lg',
            enterAnimation,
            !isStatic && 'zoom-in-50',
          )}
        />
      </div>

      {/* Text Content */}
      <div className='flex flex-col items-center gap-3'>
        <h1
          className={cn(
            'text-4xl font-bold tracking-tight',
            enterAnimation,
            !isStatic && 'fill-mode-backwards delay-100',
          )}
        >
          Akagi <span className='text-rose-500'>NG</span>
        </h1>
        <p
          className={cn(
            'text-muted-foreground text-sm font-medium tracking-wide uppercase',
            enterAnimation,
            !isStatic && 'fill-mode-backwards delay-200',
          )}
        >
          Next Generation Mahjong AI
        </p>
      </div>
    </div>
  );
}
