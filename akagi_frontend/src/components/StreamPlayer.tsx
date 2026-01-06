import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button.tsx';
import { Loader2, PictureInPicture2 } from 'lucide-react';
import StreamRenderComponent from './StreamRenderComponent.tsx';
import type { FullRecommendationData } from '@/types';

// Type augmentation
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options: { width: number; height: number }): Promise<Window>;
      window: Window | null;
      onenter: ((this: EventTarget, ev: Event) => void) | null;
    };
  }
}

interface StreamPlayerProps {
  data: FullRecommendationData | null;
}

// ==========================================
// Auto-scale logic within PiP window
// ==========================================
const PiPContent = ({ data, pipWin }: { data: FullRecommendationData | null; pipWin: Window }) => {
  const [pipScale, setPipScale] = useState(1);

  useLayoutEffect(() => {
    const handleResize = () => {
      if (!pipWin) return;

      // Get actual PiP window dimensions
      const width = pipWin.innerWidth;
      const height = pipWin.innerHeight;

      // Calculate scale to maintain 16:9 aspect ratio
      const scaleX = width / 1280;
      const scaleY = height / 720;

      // Use smaller value to ensure content is fully contained (contain mode)
      setPipScale(Math.min(scaleX, scaleY));
    };

    // Listen for PiP window resize events
    pipWin.addEventListener('resize', handleResize);
    handleResize(); // Initialize

    return () => pipWin.removeEventListener('resize', handleResize);
  }, [pipWin]);

  return (
    <div className='flex h-full w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-950'>
      <div
        style={{
          transform: `scale(${pipScale})`,
          transformOrigin: 'center center',
          width: 1280,
          height: 720,
          flexShrink: 0,
        }}
      >
        <StreamRenderComponent data={data} />
      </div>
    </div>
  );
};

const StreamPlayer: FC<StreamPlayerProps> = ({ data }) => {
  const { t } = useTranslation();
  // State management
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Auto-scale state
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ==========================================
  // Auto-scale logic (Web page mode)
  // ==========================================
  useLayoutEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        const newScale = Math.min(width / 1280, 1);
        setScale(newScale);
      }
    };

    // Initialize
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // ==========================================
  // Document Picture-in-Picture
  // ==========================================
  const startDocumentPiP = async () => {
    if (!window.documentPictureInPicture) {
      alert(t('app.pip_not_supported'));
      return;
    }

    try {
      setIsLoading(true);
      // Request 1280x720 window
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 1280,
        height: 720,
      });

      // Copy styles
      const styles = document.querySelectorAll('link[rel="stylesheet"], style');
      styles.forEach((style) => {
        pipWin.document.head.appendChild(style.cloneNode(true));
      });
      // Copy Root Class (Tailwind Dark Mode)
      pipWin.document.documentElement.className = document.documentElement.className;

      // Use Flex layout + 100% height to ensure content is correctly contained and centered
      pipWin.document.getElementsByTagName('html')[0].style.height = '100%';

      Object.assign(pipWin.document.body.style, {
        margin: '0',
        padding: '0',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: window.getComputedStyle(document.body).backgroundColor,
      });

      pipWin.addEventListener('pagehide', () => {
        setPipWindow(null);
      });

      setPipWindow(pipWin);
    } catch (err) {
      console.error('Failed to open Document PiP:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePipClick = () => {
    if (pipWindow) {
      pipWindow.close();
    } else {
      void startDocumentPiP();
    }
  };

  return (
    <div className='flex w-full flex-col items-center gap-6'>
      {/* Main Display Area */}
      <div
        ref={containerRef}
        className='group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100/50 shadow-lg dark:border-zinc-800 dark:bg-zinc-900/50'
      >
        {/* Scaled Container */}
        <div
          style={{
            transform: `scale(${scale})`,
            width: 1280,
            height: 720,
            transformOrigin: 'center center',
          }}
          className='shrink-0 transition-transform duration-100 ease-linear'
        >
          <StreamRenderComponent data={data} />
        </div>

        {/* Status Overlay */}
        {!!pipWindow && (
          <div className='absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-900/60 text-white backdrop-blur-sm transition-all duration-300'>
            <div className='mb-4 rounded-full bg-white/10 p-4 ring-1 ring-white/20'>
              <PictureInPicture2 className='h-8 w-8 opacity-90' />
            </div>
            <p className='text-lg font-medium tracking-wide'>{t('app.pip_playing_in_pip')}</p>
            <p className='mt-2 text-sm text-zinc-300'>{t('app.pip_can_switch_tabs')}</p>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className='flex w-full items-center justify-center'>
        <Button
          onClick={handlePipClick}
          disabled={isLoading}
          className={`relative transform overflow-hidden rounded-xl px-8 py-6 shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95 ${
            pipWindow
              ? 'bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-700'
              : 'bg-linear-to-r from-violet-600 to-indigo-600 text-white shadow-indigo-500/25 hover:from-violet-500 hover:to-indigo-500'
          } `}
        >
          <div className='relative z-10 flex items-center gap-3 text-base font-medium'>
            {isLoading ? (
              <Loader2 className='h-5 w-5 animate-spin' />
            ) : (
              <PictureInPicture2 className={`h-5 w-5 ${pipWindow ? '' : 'animate-pulse'}`} />
            )}
            <span>
              {isLoading
                ? t('app.pip_loading')
                : pipWindow
                  ? t('app.pip_exit')
                  : t('app.pip_start')}
            </span>
          </div>
        </Button>
      </div>

      {/* Document PiP Content */}
      {pipWindow &&
        createPortal(<PiPContent data={data} pipWin={pipWindow} />, pipWindow.document.body)}
    </div>
  );
};

export default StreamPlayer;
