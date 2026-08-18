import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FullRecommendationData } from '@/types';

import StreamRecommendation from './StreamRecommendation';

interface StreamRenderComponentProps {
  data: FullRecommendationData | null;
}

export default function StreamRenderComponent({ data }: StreamRenderComponentProps) {
  const { t } = useTranslation();
  const isHudPage = window.location.hash === '#/hud';

  if (!data) {
    if (isHudPage) {
      return <div id='render-source' className='h-full w-full' />;
    }

    return (
      <div
        id='render-source'
        className='flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center'
      >
        <div className='flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-emerald-500/20 to-teal-500/20 dark:from-emerald-500/10 dark:to-teal-500/10'>
          <Bot className='h-10 w-10 text-emerald-500 dark:text-emerald-400' />
        </div>
        <div className='space-y-2'>
          <h3 className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>
            {t('app.standby')}
          </h3>
          <p className='text-sm text-zinc-500 dark:text-zinc-400'>{t('app.standby_desc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      id='render-source'
      className='relative flex h-full w-full flex-col items-center justify-center gap-4 p-4'
    >
      {(data.recommendations || []).slice(0, 3).map((rec, index) => {
        const key = `${rec.action}-${rec.tile || ''}-${rec.consumed?.join(',') || ''}-${index}`;
        return <StreamRecommendation key={key} {...rec} />;
      })}
    </div>
  );
}
