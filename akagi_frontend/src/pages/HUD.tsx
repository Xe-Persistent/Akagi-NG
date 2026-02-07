import { X } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useRef } from 'react';

import StreamPlayer from '@/components/StreamPlayer';
import { Button } from '@/components/ui/button';
import { ModelStatusIndicator } from '@/components/ui/model-status-indicator';
import { HUD_MAX_WIDTH, HUD_MIN_WIDTH } from '@/config/constants';

export default function Hud() {
  const startPos = useRef<{ x: number; w: number; active: boolean }>({
    x: 0,
    w: 0,
    active: false,
  });

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    startPos.current = {
      x: e.screenX,
      w: window.innerWidth,
      active: true,
    };
    document.body.style.cursor = 'nwse-resize';
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!startPos.current.active) return;

    // Calculate new size
    const deltaX = e.screenX - startPos.current.x;
    const width = Math.min(HUD_MAX_WIDTH, Math.max(HUD_MIN_WIDTH, startPos.current.w + deltaX));
    // Enforce 16:9 aspect ratio
    const height = Math.round((width * 9) / 16);

    window.electron.invoke('set-window-bounds', { width, height });
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!startPos.current.active) return;

    startPos.current.active = false;
    document.body.style.cursor = '';

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  return (
    <div className='draggable group relative flex h-screen w-full items-center justify-center overflow-hidden bg-transparent'>
      <StreamPlayer className='h-full w-full' />

      {/* Model Status Indicator */}
      <ModelStatusIndicator className='top-3 left-3' />

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
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp} // Safety fallback
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
