import type { FC } from 'react';
import StreamRecommendation from './StreamRecommendation.tsx';
import type { FullRecommendationData } from '@/types';
import { cn } from '@/lib/utils';

interface StreamRenderComponentProps {
  data: FullRecommendationData | null;
}

const StreamRenderComponent: FC<StreamRenderComponentProps> = ({ data }) => {
  if (!data || data.recommendations.length === 0) {
    return (
      <div
        id='render-source'
        className={cn('flex items-center justify-center bg-transparent', 'text-zinc-800')}
        style={{ width: 1280, height: 720 }}
      >
        <div className='h-12 w-12 animate-pulse rounded-full bg-current opacity-10' />
      </div>
    );
  }

  const { recommendations } = data;

  return (
    <div
      id='render-source'
      className={cn(
        'flex flex-col items-center justify-center bg-transparent p-4 transition-all duration-300',
      )}
      style={{ width: 1280, height: 720 }}
    >
      <div className='flex w-full flex-col gap-4'>
        {recommendations.slice(0, 3).map((rec, index) => (
          <StreamRecommendation key={index + rec.action} {...rec} />
        ))}
      </div>
    </div>
  );
};

export default StreamRenderComponent;
