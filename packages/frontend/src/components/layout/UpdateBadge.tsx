import { ArrowDownToLine } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchUpdateVersionApi, openExternal } from '@/api/desktop';
import { onUpdateAvailable } from '@/api/events';
import { Badge } from '@/components/ui/badge';

/**
 * The available release, if any.
 *
 * The main process checks once per launch and broadcasts, but this badge lives
 * in a lazy chunk that can mount after the broadcast: subscribing alone would
 * miss it, so the check's result is also read on mount. The subscription is an
 * effect rather than a module-level listener for the same reason — mount order
 * must not decide whether the update is seen.
 */
export function UpdateBadge() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onUpdateAvailable(setVersion);

    void fetchUpdateVersionApi()
      .then((known) => {
        if (!cancelled && known) setVersion(known);
      })
      .catch(() => {
        // The broadcast still arrives on a later check.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!version) {
    return null;
  }

  const handleClick = () => {
    void openExternal(`https://github.com/Xe-Persistent/Akagi-NG/releases/tag/v${version}`);
  };

  return (
    <Badge
      variant='destructive'
      asChild
      className='-my-0.5 cursor-pointer gap-1.5 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400'
      onClick={handleClick}
    >
      <button>
        <ArrowDownToLine className='h-3 w-3 shrink-0' />
        <span className='w-[5ch] text-center tabular-nums'>v{version}</span>
      </button>
    </Badge>
  );
}
