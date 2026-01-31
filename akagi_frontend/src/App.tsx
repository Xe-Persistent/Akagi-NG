import 'react-toastify/dist/ReactToastify.css';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

import { ExitOverlay } from '@/components/ExitOverlay';
import { GameProvider } from '@/components/GameProvider';
import { LaunchScreen } from '@/components/LaunchScreen';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useConnectionConfig } from '@/hooks/useConnectionConfig';
import { fetchSettingsApi } from '@/hooks/useSettings';
import type { Settings } from '@/types';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Hud = lazy(() => import('@/pages/HUD'));

export default function App() {
  const { apiBase } = useConnectionConfig();

  const isHud = window.location.hash === '#/hud';

  if (isHud) {
    document.documentElement.classList.add('is-hud');
  }

  const settingsPromise = useMemo(() => {
    const fetchSettings = fetchSettingsApi(apiBase).catch((err) => {
      console.warn('Failed to fetch settings, using defaults:', err);
      return {
        log_level: 'INFO',
        locale: 'zh-CN',
        game_url: '',
        platform: 'majsoul',
        mitm: { enabled: false, host: '127.0.0.1', port: 6789, upstream: '' },
        server: { host: '127.0.0.1', port: 8765 },
        ot: { online: false, server: '', api_key: '' },
        model_config: {
          device: 'auto',
          temperature: 0.3,
          enable_amp: false,
          enable_quick_eval: false,
          rule_based_agari_guard: true,
        },
      } as Settings;
    });

    if (isHud) {
      return fetchSettings;
    }

    const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 2400));
    return Promise.all([fetchSettings, minDelay]).then(([settings]) => settings as Settings);
  }, [apiBase, isHud]);

  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!window.electron) return;
    const unsub = window.electron.on('exit-animation-start', () => {
      setIsExiting(true);
    });
    return unsub;
  }, []);

  return (
    <Suspense
      fallback={isHud ? <div className='h-screen w-screen bg-transparent' /> : <LaunchScreen />}
    >
      <ThemeProvider>
        <GameProvider>
          <HashRouter>
            <Routes>
              {/* Default Dashboard Route */}
              <Route path='/' element={<Dashboard settingsPromise={settingsPromise} />} />

              {/* HUD Route for Overlay Mode */}
              <Route path='/hud' element={<Hud />} />
            </Routes>
          </HashRouter>
        </GameProvider>
        {isExiting && <ExitOverlay />}
      </ThemeProvider>
    </Suspense>
  );
}
