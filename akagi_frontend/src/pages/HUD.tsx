import { X } from 'lucide-react';

import StreamPlayer from '@/components/StreamPlayer';
import { Button } from '@/components/ui/button';

export function Hud() {
  const handleClose = () => {
    window.electron?.invoke('toggle-hud', false);
  };

  return (
    <div className='draggable group relative flex h-screen w-full items-center justify-center overflow-hidden bg-transparent'>
      <StreamPlayer className='h-full w-full' />

      <div className='no-drag absolute top-2 right-2 opacity-40 transition-opacity hover:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 rounded-full bg-transparent text-white hover:bg-white/20 dark:text-zinc-200 dark:hover:bg-zinc-800/50'
          onClick={handleClose}
        >
          <X className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
