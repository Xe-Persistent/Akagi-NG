import { memo, useEffect, useEffectEvent, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface ConfidenceRingProps {
  percentage: number;
  color: string;
  size?: number;
  stroke?: number;
  fontSize?: string;
}

export const ConfidenceRing = memo(
  function ConfidenceRing({
    percentage,
    color,
    size = 112,
    stroke = 8,
    fontSize = 'text-5xl',
  }: ConfidenceRingProps) {
    const [currentPercentage, setCurrentPercentage] = useState(percentage);
    const [sprintPhase, setSprintPhase] = useState(0);
    const valueAnimationRef = useRef<number | undefined>(undefined);
    const sprintAnimationRef = useRef<number | undefined>(undefined);
    const startTimeRef = useRef<number | undefined>(undefined);
    const startValueRef = useRef(percentage);
    const targetValueRef = useRef(percentage);
    const isFirstRenderRef = useRef(true);

    /** Where the last frame left the ring; read without making the effect depend on it. */
    const readCurrentPercentage = useEffectEvent(() => currentPercentage);

    useEffect(() => {
      // Nothing to animate on the first render.
      if (isFirstRenderRef.current) {
        isFirstRenderRef.current = false;
        startValueRef.current = percentage;
        targetValueRef.current = percentage;
        return;
      }

      // Start from wherever the ring currently is.
      startValueRef.current = readCurrentPercentage();
      targetValueRef.current = percentage;
      startTimeRef.current = undefined;

      const animate = (time: number) => {
        if (startTimeRef.current === undefined) {
          startTimeRef.current = time;
        }
        const elapsed = time - startTimeRef.current;
        const duration = 1000;

        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const nextValue =
          startValueRef.current + (targetValueRef.current - startValueRef.current) * easeOut;
        setCurrentPercentage(nextValue);

        if (progress < 1) {
          valueAnimationRef.current = requestAnimationFrame(animate);
        }
      };

      valueAnimationRef.current = requestAnimationFrame(animate);

      return () => {
        if (valueAnimationRef.current) {
          cancelAnimationFrame(valueAnimationRef.current);
        }
      };
    }, [percentage]);

    // The beam sweep runs for as long as the ring is mounted.
    useEffect(() => {
      const duration = 1500;

      const loop = (time: number) => {
        // Phase comes from the clock, not an accumulator.
        const phase = (time % duration) / duration;

        // Sweep for the first 70% of the loop, rest for the last 30%.
        const activePhase = Math.min(phase / 0.7, 1);

        // The same curve as cubic-bezier(0.4, 0, 0.2, 1).
        const eased = 1 - Math.pow(1 - activePhase, 3);

        setSprintPhase(eased);
        sprintAnimationRef.current = requestAnimationFrame(loop);
      };
      sprintAnimationRef.current = requestAnimationFrame(loop);
      return () => {
        if (sprintAnimationRef.current) cancelAnimationFrame(sprintAnimationRef.current);
      };
    }, []);

    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - currentPercentage * circumference;

    // The beam tracks the value, scaled by the sweep phase.
    const currentBeamDashoffset = circumference * (1 - currentPercentage * sprintPhase);

    const fadeStart = 0.6;
    const opacity =
      sprintPhase > fadeStart ? 1 - Math.pow((sprintPhase - fadeStart) / (1 - fadeStart), 2) : 1;

    return (
      <div style={{ width: size, height: size }} className='relative'>
        <svg className='h-full w-full -rotate-90 transform overflow-visible'>
          <circle
            cx='50%'
            cy='50%'
            r={radius}
            stroke='currentColor'
            strokeWidth={stroke}
            fill='transparent'
            className='text-zinc-300 dark:text-zinc-800'
          />

          {/* The value ring, drawn smoothly. */}
          <circle
            cx='50%'
            cy='50%'
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            fill='transparent'
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap='round'
            style={{
              filter: `drop-shadow(0 0 4px ${color})`,
            }}
            className='transition-colors duration-300'
          />

          {/* A white beam sweeping around the ring. */}
          <circle
            cx='50%'
            cy='50%'
            r={radius}
            stroke='white'
            strokeWidth={stroke}
            fill='transparent'
            strokeDasharray={circumference}
            strokeDashoffset={currentBeamDashoffset}
            strokeLinecap='round'
            style={{
              filter: `drop-shadow(0 0 4px ${color})`,
              opacity: opacity * 0.4,
            }}
          />
        </svg>

        {/* The tip sits at the end of the value ring. */}
        {currentPercentage > 0 && (
          <div
            className='z-content absolute inset-0'
            style={{
              transform: `rotate(${currentPercentage * 360}deg)`,
            }}
          >
            <div
              className='absolute left-1/2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_4px_rgba(255,255,255,0.9)]'
              style={{
                width: stroke,
                height: stroke,
                top: 0,
              }}
            />
          </div>
        )}

        <div className='absolute inset-0 flex items-center justify-center'>
          <span className={cn(fontSize, 'font-mono font-bold text-zinc-700 dark:text-zinc-200')}>
            {(currentPercentage * 100).toFixed(0)}
            <span className='text-[0.6em]'>%</span>
          </span>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // The ring only prints whole percent (`toFixed(0)`), so a smaller change
    // would restart the animation to no visible effect.
    return (
      Math.abs(prevProps.percentage - nextProps.percentage) < 0.01 &&
      prevProps.color === nextProps.color &&
      prevProps.size === nextProps.size &&
      prevProps.stroke === nextProps.stroke &&
      prevProps.fontSize === nextProps.fontSize
    );
  },
);
