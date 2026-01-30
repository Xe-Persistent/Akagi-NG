import { cn } from '@/lib/utils';

export function LaunchScreen({
  className,
  isStatic = false,
}: {
  className?: string;
  isStatic?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col items-center justify-center transition-opacity duration-500',
        !isStatic && 'animate-in fade-in zoom-in-95',
        className,
      )}
    >
      <div className='flex flex-col items-center space-y-8 p-8'>
        {/* Logo Container with Glow Effect */}
        <div className='relative'>
          <div className='logo-glow-effect' />
          <img
            src='torii.svg'
            alt='Akagi Logo'
            className={cn(
              'relative h-24 w-24 drop-shadow-lg duration-1000 lg:h-32 lg:w-32',
              !isStatic && 'animate-in fade-in zoom-in-50 slide-in-from-bottom-4',
            )}
          />
        </div>

        {/* Text Content */}
        <div className='flex flex-col items-center space-y-3 text-center'>
          <h1
            className={cn(
              'text-3xl font-bold tracking-tight duration-1000 lg:text-4xl',
              !isStatic &&
                'animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards delay-150',
            )}
          >
            Akagi <span className='text-rose-500'>NG</span>
          </h1>
          <p
            className={cn(
              'text-muted-foreground text-sm font-medium tracking-wide uppercase duration-1000',
              !isStatic &&
                'animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards delay-300',
            )}
          >
            Next Generation Mahjong AI
          </p>
        </div>
      </div>
    </div>
  );
}
