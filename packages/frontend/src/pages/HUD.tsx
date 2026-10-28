import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import StreamPlayer from '@/components/StreamPlayer';
import { HudControlButton } from '@/components/ui/hud-control-button';
import { ModelStatusIndicator } from '@/components/ui/model-status-indicator';
import { useGame } from '@/hooks/useGame';

export default function Hud() {
  const { t } = useTranslation();
  const { setHudVisible } = useGame();

  return (
    <div className='draggable relative h-screen w-full overflow-hidden'>
      <StreamPlayer className='h-full w-full' />

      <ModelStatusIndicator className='top-3 left-3' />

      <HudControlButton
        className='absolute top-2 right-2'
        aria-label={t('app.hide_hud')}
        onClick={() => setHudVisible(false)}
      >
        <X className='h-4 w-4' />
      </HudControlButton>
    </div>
  );
}
