import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { requestShutdown } from '@/api/desktop';
import { onRequestAppQuit } from '@/api/events';
import { errorMessage } from '@/lib/error';
import { notify } from '@/lib/notify';

/**
 * The quit confirmation, which the dashboard owns for the whole app: the tray
 * asks for it instead of quitting, so an accidental click cannot end the session.
 */
export function useShutdownDialog() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => onRequestAppQuit(() => setIsOpen(true)), []);

  const confirm = useCallback(async () => {
    setIsOpen(false);
    try {
      await requestShutdown();
    } catch (error) {
      notify.error(`${t('common.error')}: ${errorMessage(error)}`);
    }
  }, [t]);

  return { isOpen, setIsOpen, confirm };
}
