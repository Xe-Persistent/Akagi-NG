import { type FC, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { FullRecommendationData } from '@/types';

import StreamRecommendation from './StreamRecommendation.tsx';

interface StreamRenderComponentProps {
  data: FullRecommendationData | null;
}

const StreamRenderComponent: FC<StreamRenderComponentProps> = ({ data }) => {
  const recommendations = useMemo(() => data?.recommendations || [], [data]);
  const is_riichi = data?.is_riichi || false;

  const filteredRecommendations = useMemo(() => {
    return is_riichi
      ? recommendations.filter(
          (rec) => ['kan', 'tsumo', 'ron', 'ryukyoku', 'nukidora'].includes(rec.action) || false,
        )
      : recommendations;
  }, [recommendations, is_riichi]);

  if (!data || recommendations.length === 0) {
    return (
      <div
        id='render-source'
        className={cn('flex items-center justify-center bg-transparent', 'text-zinc-800')}
        style={{ width: 'var(--stream-width)', height: 'var(--stream-height)' }}
      >
        <div className='h-12 w-12 animate-pulse rounded-full bg-current opacity-10' />
      </div>
    );
  }

  if (is_riichi && filteredRecommendations.length === 0) {
    return null;
  }

  return (
    <div
      id='render-source'
      className='relative flex flex-col items-center justify-center bg-transparent p-4'
      style={{ width: 'var(--stream-width)', height: 'var(--stream-height)' }}
    >
      <div className='flex w-full flex-col gap-4'>
        {filteredRecommendations.slice(0, 3).map((rec, index) => {
          const key = `${rec.action}-${rec.tile || ''}-${rec.consumed?.join(',') || ''}-${index}`;
          return <StreamRecommendation key={key} {...rec} />;
        })}
      </div>
    </div>
  );
};

export default StreamRenderComponent;
