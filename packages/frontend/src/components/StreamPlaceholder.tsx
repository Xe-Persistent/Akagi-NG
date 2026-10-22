import { Bot, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** The two reasons the board has nothing to show. */
export type PlaceholderKind = 'standby' | 'hudActive';

const LOOKS = {
  standby: {
    icon: Bot,
    title: 'app.standby',
    description: 'app.standby_desc',
    tint: 'from-emerald-500/20 to-teal-500/20 dark:from-emerald-500/10 dark:to-teal-500/10',
    color: 'text-emerald-500 dark:text-emerald-400',
  },
  hudActive: {
    icon: Monitor,
    title: 'app.hud_active',
    description: 'app.hud_desc',
    tint: 'from-pink-500/20 to-violet-500/20 dark:from-pink-500/10 dark:to-violet-500/10',
    color: 'text-pink-500 dark:text-pink-400',
  },
} as const;

/**
 * What the board says when there is nothing to recommend.
 *
 * It is rendered outside the scaled stage on purpose: the recommendation panel
 * zooms with its window, but a hint at a quarter of its size cannot be read. The
 * icon and the text keep their pixel size; only the stage scales.
 */
export function StreamPlaceholder({ kind }: { kind: PlaceholderKind }) {
  const { t } = useTranslation();
  const look = LOOKS[kind];
  const Icon = look.icon;

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-4 p-4 text-center'>
      <div
        className={cn(
          'flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-linear-to-br',
          look.tint,
        )}
      >
        <Icon className={cn('h-10 w-10', look.color)} />
      </div>
      <div className='space-y-2'>
        <h3 className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>{t(look.title)}</h3>
        <p className='text-sm text-zinc-500 dark:text-zinc-400'>{t(look.description)}</p>
      </div>
    </div>
  );
}
