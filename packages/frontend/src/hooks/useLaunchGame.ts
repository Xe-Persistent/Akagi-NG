import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { startGame } from '@/api/desktop';
import { fetchSettingsApi } from '@/api/settings';
import { useSettings } from '@/hooks/useSettings';
import { notify } from '@/lib/notify';

/**
 * Opening the game window. The stored settings are read again instead of trusted
 * from the provider, because the player may have changed the URL or the capture
 * mode in another window; the provider's copy is the fallback if that read fails.
 */
export function useLaunchGame() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [isLaunching, setIsLaunching] = useState(false);

  const launch = useCallback(async () => {
    setIsLaunching(true);
    try {
      const current = await fetchSettingsApi().catch(() => settings);
      await startGame({
        url: current.game_url,
        useMitm: current.mitm.enabled,
      });
    } catch (error) {
      console.error('Failed to start game window:', error);
      notify.error(t('app.launch_error'));
    } finally {
      setIsLaunching(false);
    }
  }, [settings, t]);

  return { isLaunching, launch };
}
