import type {FC} from 'react';
import StreamRecommendation from './StreamRecommendation.tsx';
import type {FullRecommendationData} from './types.ts';
import {cn} from '@/lib/utils';


interface StreamRenderComponentProps {
    data: FullRecommendationData | null;
}

const StreamRenderComponent: FC<StreamRenderComponentProps> = ({data}) => {
    if (!data || data.recommendations.length === 0) {
        return (
            <div
                id="render-source"
                className={cn(
                    "flex items-center justify-center bg-transparent",
                    "text-zinc-800"
                )}
                style={{width: 1280, height: 720}}
            >
                <div className="w-12 h-12 bg-current rounded-full opacity-10 animate-pulse"/>
            </div>
        );
    }

    const {recommendations} = data;

    return (
        <div
            id="render-source"
            className={cn(
                "flex flex-col justify-center items-center bg-transparent p-4 transition-all duration-300"
            )}
            style={{width: 1280, height: 720}}>
            <div className="w-full flex flex-col gap-4">
                {recommendations.slice(0, 3).map((rec, index) => (
                    <StreamRecommendation
                        key={index + rec.action}
                        {...rec}
                    />
                ))}
            </div>
        </div>
    );
};

export default StreamRenderComponent;