import 'react-toastify/dist/ReactToastify.css';

import { lazy, Suspense, use, useEffect, useMemo, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router';

import { ExitOverlay } from '@/components/ExitOverlay';
import { GameProvider } from '@/components/GameProvider';
import { LaunchScreen } from '@/components/LaunchScreen';
import { SettingsProvider } from '@/components/SettingsProvider';
import { StartupErrorBoundary } from '@/components/StartupErrorBoundary';
import { ThemeProvider } from '@/components/ThemeProvider';
import { APP_SPLASH_EXIT_MS, APP_SPLASH_SHOW_MS } from '@/config/constants';
import { isHudWindow } from '@/lib/routing';
import { fetchSettingsApi } from '@/lib/settings-api';
import { cn } from '@/lib/utils';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Hud = lazy(() => import('@/pages/HUD'));

/**
 * 带有中止信号的等待工具函数
 */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * 应用程序初始化逻辑
 */
const initApp = async () => {
  if (!window.electron) {
    throw new Error('Akagi-NG requires Electron environment to boot.');
  }
  const settings = await fetchSettingsApi();
  return { settings };
};

type AppData = Awaited<ReturnType<typeof initApp>>;

interface AppInnerProps {
  appDataPromise: Promise<AppData>;
  isHud: boolean;
}

function AppInner({ appDataPromise, isHud }: AppInnerProps) {
  const data = use(appDataPromise);
  const settingsPromise = useMemo(
    () => appDataPromise.then((resolved) => resolved.settings),
    [appDataPromise],
  );
  const [isExiting, setIsExiting] = useState(false);

  const [splashStage, setSplashStage] = useState<'splash' | 'exiting' | 'ready'>(
    isHud ? 'ready' : 'splash',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('is-hud', isHud);
    return () => {
      document.documentElement.classList.remove('is-hud');
    };
  }, [isHud]);

  useEffect(() => {
    if (isHud) return;

    const ac = new AbortController();
    (async () => {
      try {
        await wait(APP_SPLASH_SHOW_MS, ac.signal);
        setSplashStage('exiting');
        await wait(APP_SPLASH_EXIT_MS, ac.signal);
        setSplashStage('ready');
      } catch {
        /* Aborted */
      }
    })();

    return () => ac.abort();
  }, [isHud]);

  useEffect(() => {
    if (!window.electron) return;
    const unsubExit = window.electron.on('exit-animation-start', () => setIsExiting(true));
    return () => unsubExit();
  }, []);

  return (
    <SettingsProvider initialSettings={data.settings}>
      <GameProvider>
        <HashRouter>
          <Routes>
            <Route
              path='/'
              element={
                <Dashboard
                  settingsPromise={settingsPromise}
                  isSplashActive={!isHud && splashStage === 'splash'}
                />
              }
            />
            <Route path='/hud' element={<Hud />} />
          </Routes>
        </HashRouter>
      </GameProvider>

      {!isHud && splashStage !== 'ready' && (
        <LaunchScreen
          isStatic={true}
          className={cn(
            splashStage === 'exiting' &&
              'animate-out fade-out-0 zoom-out-95 fill-mode-forwards duration-1000',
          )}
        />
      )}

      {isExiting && <ExitOverlay />}
    </SettingsProvider>
  );
}

export default function App() {
  // Created once per window, so React never re-suspends on a fresh promise.
  const [appDataPromise] = useState(initApp);
  const isHud = isHudWindow();

  return (
    <ThemeProvider>
      <StartupErrorBoundary>
        <Suspense fallback={isHud ? <div className='h-full' /> : <LaunchScreen />}>
          <AppInner appDataPromise={appDataPromise} isHud={isHud} />
        </Suspense>
      </StartupErrorBoundary>
    </ThemeProvider>
  );
}
