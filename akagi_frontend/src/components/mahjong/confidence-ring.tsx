import type {FC} from 'react';

interface ConfidenceRingProps {
    percentage: number;
    color: string;
    size?: number;
    stroke?: number;
    fontSize?: string;
}

export const ConfidenceRing: FC<ConfidenceRingProps> = ({
                                                            percentage,
                                                            color,
                                                            size = 112,
                                                            stroke = 8,
                                                            fontSize = "text-5xl"
                                                        }) => {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage * circumference);

    return (
        <div style={{width: size, height: size}} className="relative flex items-center justify-center">
            {/* Background Ring */}
            <svg className="transform -rotate-90 w-full h-full">
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke="currentColor" strokeWidth={stroke} fill="transparent"
                    className="text-zinc-200 dark:text-zinc-800"
                />
                {/* Progress Ring */}
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke={color} strokeWidth={stroke} fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center inset-0">
                <span className={`${fontSize} font-bold text-zinc-700 dark:text-zinc-200 font-mono`}>
                    {(percentage * 100).toFixed(0)}
                    <span className="text-[0.6em]">%</span>
                </span>
            </div>
        </div>
    );
};
