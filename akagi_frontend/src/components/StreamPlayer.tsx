import { Loader2, PictureInPicture2 } from 'lucide-react';
import { type FC, use, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import { PIP_WINDOW_HEIGHT, PIP_WINDOW_WIDTH } from '@/config/constants';
import { GameContext } from '@/contexts/GameContext';
import { notify } from '@/lib/notify';
import type { FullRecommendationData } from '@/types';

import StreamRenderComponent from './StreamRenderComponent.tsx';

// ==========================================
// PiP 窗口内自动缩放逻辑
// ==========================================
const PiPContent = ({ data, pipWin }: { data: FullRecommendationData | null; pipWin: Window }) => {
  const [pipScale, setPipScale] = useState(1);

  useLayoutEffect(() => {
    if (!pipWin) return;

    const handleResize = (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        const effectiveWidth = width || pipWin.innerWidth;
        const effectiveHeight = height || pipWin.innerHeight;

        const scaleX = effectiveWidth / PIP_WINDOW_WIDTH;
        const scaleY = effectiveHeight / PIP_WINDOW_HEIGHT;

        setPipScale(Math.min(scaleX, scaleY));
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(pipWin.document.body);

    return () => {
      observer.disconnect();
    };
  }, [pipWin]);

  return (
    <div className='flex h-full w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-950'>
      <div
        style={{
          transform: `scale(${pipScale})`,
          transformOrigin: 'center center',
          width: PIP_WINDOW_WIDTH,
          height: PIP_WINDOW_HEIGHT,
          flexShrink: 0,
        }}
      >
        <StreamRenderComponent data={data} />
      </div>
    </div>
  );
};

const StreamPlayer: FC = () => {
  const context = use(GameContext);
  if (!context) throw new Error('GameContext not found');
  const { data } = context;

  const { t } = useTranslation();
  // 状态管理
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 自动缩放状态
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ==========================================
  // 网页模式自动缩放逻辑
  // ==========================================
  useLayoutEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        const newScale = Math.min(width / PIP_WINDOW_WIDTH, 1);
        setScale(newScale);
      }
    };

    // 初始化
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // ==========================================
  // Document PiP
  // ==========================================
  const startDocumentPiP = async () => {
    if (!window.documentPictureInPicture) {
      notify.warn(t('app.pip_not_supported'));
      return;
    }

    try {
      setIsLoading(true);
      // 请求 1280x720 窗口
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: PIP_WINDOW_WIDTH,
        height: PIP_WINDOW_HEIGHT,
      });

      // 复制样式表
      const styles = document.querySelectorAll('link[rel="stylesheet"], style');
      styles.forEach((style) => {
        pipWin.document.head.appendChild(style.cloneNode(true));
      });
      // 复制根元素 class（Tailwind 暗色模式）
      pipWin.document.documentElement.className = document.documentElement.className;

      // 使用 Flex 布局确保内容居中
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
      <div ref={containerRef} className='stream-player-container group'>
        {/* Scaled Container */}
        <div
          style={{
            transform: `scale(${scale})`,
            width: PIP_WINDOW_WIDTH,
            height: PIP_WINDOW_HEIGHT,
            transformOrigin: 'center center',
          }}
          className='shrink-0 transition-transform duration-100 ease-linear'
        >
          <StreamRenderComponent data={data} />
        </div>

        {/* Status Overlay */}
        {!!pipWindow && (
          <div className='pip-overlay'>
            <div className='pip-icon-wrapper'>
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
