import { X } from 'lucide-react';

import StreamPlayer from '@/components/StreamPlayer';
import { HudControlButton } from '@/components/ui/hud-control-button';
import { ModelStatusIndicator } from '@/components/ui/model-status-indicator';

export default function Hud() {
  return (
    <div className='draggable relative h-screen w-full overflow-hidden'>
      <StreamPlayer className='h-full w-full' />

      <ModelStatusIndicator className='top-3 left-3' />

      <HudControlButton
        className='absolute top-2 right-2'
        onClick={() => window.electron.invoke('toggle-hud', false)}
      >
        <X className='h-4 w-4' />
      </HudControlButton>
    </div>
  );
}
