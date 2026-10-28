import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { notify } from '@/lib/notify';
import type { ModelState, ResourceStatus } from '@/types';

/** One id for the install-level warning, so raising and clearing it agree. */
const MODELS_MISSING_TOAST = 'models_missing';

/**
 * The "model files are missing" warning, which the engine status cannot report:
 * it describes the install, not a session. Raised once the check answers and
 * retired either when the files appear or when a model actually loads — the
 * second path matters because the check itself only runs once per launch.
 */
export function useModelsMissingToast(
  resourceStatus: ResourceStatus | null,
  modelState: ModelState | undefined,
) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!resourceStatus) return;

    if (resourceStatus.models) {
      notify.dismiss(MODELS_MISSING_TOAST);
      return;
    }

    notify.warn(t('notify.models_missing'), {
      toastId: MODELS_MISSING_TOAST,
      autoClose: false,
    });
  }, [resourceStatus, t]);

  useEffect(() => {
    if (modelState === 'ready') notify.dismiss(MODELS_MISSING_TOAST);
  }, [modelState]);
}
