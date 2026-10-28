import { useEffect, useState } from 'react';

import { checkResourceStatus } from '@/api/desktop';
import type { ResourceStatus } from '@/types';

/**
 * Reads the install-level resource status once per mount. `null` means the
 * answer has not arrived yet, which the callers treat as "nothing to say".
 */
export function useResourceStatus(): ResourceStatus | null {
  const [status, setStatus] = useState<ResourceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    void checkResourceStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        console.error('Failed to check resource status:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
