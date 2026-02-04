import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import StreamPlayer from '@/components/StreamPlayer';
import { Button } from '@/components/ui/button';

export default function Hud() {
  const [resizing, setResizing] = useState(false);
  const startPos = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(true);
    startPos.current = {
      x: e.screenX,
      y: e.screenY,
      w: window.innerWidth,
      h: window.innerHeight,
    };
    document.body.style.cursor = 'nwse-resize';
  };

  useEffect(() => {
    if (!resizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const deltaX = e.screenX - startPos.current.x;
      const width = Math.min(1280, Math.max(320, startPos.current.w + deltaX));
      const height = Math.round((width * 9) / 16);
      window.electron.invoke('set-window-bounds', { width, height });
    };

    const handlePointerUp = (e: PointerEvent) => {
      setResizing(false);
      document.body.style.cursor = '';
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizing]);

  return (
    <div className='draggable group relative flex h-screen w-full items-center justify-center overflow-hidden bg-transparent'>
      <StreamPlayer className='h-full w-full' />

      {/* Resize Overlay */}
      {resizing && <div className='no-drag fixed inset-0 z-50 cursor-nwse-resize bg-transparent' />}

      {/* Close Button */}
      <div className='no-drag absolute top-2 right-2 z-60 opacity-40 transition-opacity hover:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 rounded-full bg-transparent text-white hover:bg-white/20 dark:text-zinc-200 dark:hover:bg-zinc-800/50'
          onClick={() => window.electron.invoke('toggle-hud', false)}
        >
          <X className='h-4 w-4' />
        </Button>
      </div>

      {/* Resize Handle */}
      <div className='no-drag absolute right-1 bottom-1 z-60 opacity-40 transition-opacity hover:opacity-100'>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 cursor-nwse-resize rounded-full bg-transparent text-white hover:bg-white/20 dark:text-zinc-200 dark:hover:bg-zinc-800/50'
          onPointerDown={handleResizeStart}
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
          >
            <line x1='22' y1='10' x2='10' y2='22' />
            <line x1='22' y1='16' x2='16' y2='22' />
          </svg>
        </Button>
      </div>
    </div>
  );
}
