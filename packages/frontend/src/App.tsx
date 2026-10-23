import 'react-toastify/dist/ReactToastify.css';

import { lazy, Suspense, use, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { ToastContainer } from 'react-toastify';

import { fetchSettingsApi } from '@/api/settings';
import { ExitOverlay } from '@/components/ExitOverlay';
import { GameProvider } from '@/components/GameProvider';
import { LaunchScreen } from '@/components/LaunchScreen';
import { SettingsProvider } from '@/components/SettingsProvider';
import { StartupErrorBoundary } from '@/components/StartupErrorBoundary';
import { ThemeProvider } from '@/components/ThemeProvider';
import {
  APP_SPLASH_ENTER_MS,
  APP_SPLASH_EXIT_MS,
  APP_SPLASH_HOLD_MS,
  TOAST_DURATION_DEFAULT,
} from '@/config/constants';
import { useTheme } from '@/hooks/useTheme';
import { isHudWindow } from '@/lib/routing';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Hud = lazy(() => import('@/pages/HUD'));

/** Loads the settings before the first paint, so the theme is right from frame one. */
const initApp = async () => {
  if (!window.electron) {
    throw new Error('Akagi-NG requires Electron environment to boot.');
  }
  const settings = await fetchSettingsApi();
  return { settings };
};

type AppData = Awaited<ReturnType<typeof initApp>>;

/** `enter` and `hold` cover the app; `exit` cross-fades to it. */
type SplashStage = 'enter' | 'hold' | 'exit' | 'done';

/**
 * The splash timeline as data: each stage runs for its own duration and then
 * hands over to the next. `satisfies` keeps a new stage from being forgotten.
 */
const SPLASH_TIMELINE = {
  enter: { ms: APP_SPLASH_ENTER_MS, next: 'hold' },
  hold: { ms: APP_SPLASH_HOLD_MS, next: 'exit' },
  exit: { ms: APP_SPLASH_EXIT_MS, next: 'done' },
} as const satisfies Record<Exclude<SplashStage, 'done'>, { ms: number; next: SplashStage }>;

interface AppInnerProps {
  appDataPromise: Promise<AppData>;
  isHud: boolean;
  isSplashActive: boolean;
  onReady: () => void;
}

function AppInner({ appDataPromise, isHud, isSplashActive, onReady }: AppInnerProps) {
  const data = use(appDataPromise);
  const { resolvedTheme } = useTheme();
  const settingsPromise = useMemo(
    () => appDataPromise.then((resolved) => resolved.settings),
    [appDataPromise],
  );
  const [isExiting, setIsExiting] = useState(false);

  // Reaching this effect means the routes below have rendered, which is exactly
  // when the splash may go. `useEffectEvent` keeps the callback out of the deps,
  // so a new identity from the parent cannot re-fire it.
  const notifyReady = useEffectEvent(onReady);
  useEffect(() => {
    notifyReady();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('is-hud', isHud);
    return () => {
      document.documentElement.classList.remove('is-hud');
    };
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
                <Dashboard settingsPromise={settingsPromise} isSplashActive={isSplashActive} />
              }
            />
            <Route path='/hud' element={<Hud />} />
          </Routes>
        </HashRouter>
      </GameProvider>

      {isExiting && <ExitOverlay />}

      {/*
        Every window shares one renderer bundle, and a toast must reach whichever
        one the user is looking at: the dashboard, or the HUD floating over the
        game. Keeping the container here rather than on a page is what lets a
        notice arrive in both.
      */}
      <ToastContainer
        autoClose={TOAST_DURATION_DEFAULT}
        position='top-right'
        theme={resolvedTheme}
      />
    </SettingsProvider>
  );
}

export default function App() {
  // Created once per window, so React never re-suspends on a fresh promise.
  const [appDataPromise] = useState(initApp);
  const isHud = isHudWindow();
  const [isAppReady, setIsAppReady] = useState(false);
  const [splashStage, setSplashStage] = useState<SplashStage>(isHud ? 'done' : 'enter');

  // The hold is the only stage that also waits for the app behind the splash.
  // Every other stage keeps its own clock, so becoming ready halfway through the
  // entrance must not restart it.
  const canAdvance = splashStage !== 'hold' || isAppReady;

  useEffect(() => {
    if (!canAdvance || splashStage === 'done') return;

    const { ms, next } = SPLASH_TIMELINE[splashStage];
    const timer = setTimeout(() => setSplashStage(next), ms);
    return () => clearTimeout(timer);
  }, [splashStage, canAdvance]);

  return (
    <ThemeProvider>
      <StartupErrorBoundary>
        <Suspense fallback={null}>
          <AppInner
            appDataPromise={appDataPromise}
            isHud={isHud}
            isSplashActive={splashStage === 'enter' || splashStage === 'hold'}
            onReady={() => setIsAppReady(true)}
          />
        </Suspense>
        {/*
          The splash lives outside the boundary on purpose: a boundary can fall
          back more than once (the settings, then a lazy route), and an animated
          fallback restarts from the start each time before being replaced.
        */}
        {splashStage !== 'done' && <LaunchScreen exiting={splashStage === 'exit'} />}
      </StartupErrorBoundary>
    </ThemeProvider>
  );
}
