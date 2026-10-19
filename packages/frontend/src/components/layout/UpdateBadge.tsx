import { ArrowDownToLine } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Badge } from '@/components/ui/badge';

type StoreSnapshot = { version: string };

let snapshot: StoreSnapshot = { version: '' };
const listeners = new Set<() => void>();

const updateSnapshot = (version: string) => {
  snapshot = { version };
  listeners.forEach((l) => l());
};

window.electron.on('app:update-available', (version: string) => updateSnapshot(version));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;

export function UpdateBadge() {
  const { version } = useSyncExternalStore(subscribe, getSnapshot);

  if (!version) {
    return null;
  }

  const handleClick = () => {
    window.electron.invoke(
      'open-external',
      `https://github.com/Xe-Persistent/Akagi-NG/releases/tag/v${version}`,
    );
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
