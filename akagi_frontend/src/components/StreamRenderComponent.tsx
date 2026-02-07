import { type FC, memo, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { FullRecommendationData } from '@/types';

import StreamRecommendation from './StreamRecommendation';

interface StreamRenderComponentProps {
  data: FullRecommendationData | null;
}

const StreamRenderComponent: FC<StreamRenderComponentProps> = memo(({ data }) => {
  const recommendations = useMemo(() => data?.recommendations || [], [data]);

  if (!data || recommendations.length === 0) {
    return (
      <div
        id='render-source'
        className={cn(
          'flex h-full w-full items-center justify-center bg-transparent',
          'text-zinc-800',
        )}
      >
        <div className='h-12 w-12 animate-pulse rounded-full bg-current opacity-10' />
      </div>
    );
  }

  return (
    <div
      id='render-source'
      className='relative flex h-full w-full flex-col items-center justify-center bg-transparent p-4'
    >
      <div className='flex w-full flex-col gap-4'>
        {recommendations.slice(0, 3).map((rec, index) => {
          const key = `${rec.action}-${rec.tile || ''}-${rec.consumed?.join(',') || ''}-${index}`;
          return <StreamRecommendation key={key} {...rec} />;
        })}
      </div>
    </div>
  );
});

StreamRenderComponent.displayName = 'StreamRenderComponent';

export default StreamRenderComponent;
