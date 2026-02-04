import { type FC, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface ConfidenceRingProps {
  percentage: number;
  color: string;
  size?: number;
  stroke?: number;
  fontSize?: string;
}

export const ConfidenceRing: FC<ConfidenceRingProps> = memo(
  ({ percentage, color, size = 112, stroke = 8, fontSize = 'text-5xl' }) => {
    const [currentPercentage, setCurrentPercentage] = useState(percentage);
    const valueAnimationRef = useRef<number | undefined>(undefined);
    const sprintAnimationRef = useRef<number | undefined>(undefined);
    const startTimeRef = useRef<number | undefined>(undefined);
    const startValueRef = useRef(percentage);
    const targetValueRef = useRef(percentage);
    const isFirstRenderRef = useRef(true);

    const currentPercentageRef = useRef(currentPercentage);
    useLayoutEffect(() => {
      currentPercentageRef.current = currentPercentage;
    }, [currentPercentage]);

    useEffect(() => {
      // 首次渲染时跳过动画
      if (isFirstRenderRef.current) {
        isFirstRenderRef.current = false;
        startValueRef.current = percentage;
        targetValueRef.current = percentage;
        return;
      }

      // 目标变化时重置动画
      startValueRef.current = currentPercentageRef.current;
      targetValueRef.current = percentage;
      startTimeRef.current = undefined;

      const animate = (time: number) => {
        if (startTimeRef.current === undefined) {
          startTimeRef.current = time;
        }
        const elapsed = time - startTimeRef.current;
        const duration = 1000; // 1 秒动画

        // 缓动曲线
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

    // 光束效果动画循环
    const [sprintPhase, setSprintPhase] = useState(0);
    useEffect(() => {
      const duration = 1500; // 每次循环 1.5 秒

      const loop = (time: number) => {
        // 使用全局时间计算循环相位
        const phase = (time % duration) / duration;

        // 在 0-0.7 时进行动画，0.7-1.0 时暂停
        const activePhase = Math.min(phase / 0.7, 1);

        // 缓动曲线
        // 近似 cubic-bezier(0.4, 0, 0.2, 1)
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

    // 计算光束填充效果的进度
    // portionFilled = currentPercentage * sprintPhase (循环期间 0 到 1)
    const currentBeamDashoffset = circumference * (1 - currentPercentage * sprintPhase);

    const fadeStart = 0.6;
    const opacity =
      sprintPhase > fadeStart
        ? 1 - Math.pow((sprintPhase - fadeStart) / (1 - fadeStart), 2) // 二次渐隐
        : 1;

    return (
      <div
        style={{ width: size, height: size }}
        className='relative flex items-center justify-center'
      >
        {/* Background Ring */}
        <svg className='h-full w-full -rotate-90 transform overflow-visible'>
          {/* Main Background Track */}
          <circle
            cx='50%'
            cy='50%'
            r={radius}
            stroke='currentColor'
            strokeWidth={stroke}
            fill='transparent'
            className='text-zinc-300 dark:text-zinc-800'
          />

          {/* Main Progress Ring (Static/Smooth) */}
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

          {/* Sprinting Beam - Single On-Curve Beam */}
          <circle
            cx='50%'
            cy='50%'
            r={radius}
            stroke='white' // 使用白色作为高强度高亮
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

        {/* The "Light" Tip / Cursor - Main Tip follows actual value */}
        {currentPercentage > 0 && (
          <div
            className='absolute inset-0 z-10'
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

        <div className='absolute inset-0 flex flex-col items-center justify-center'>
          <span className={cn(fontSize, 'font-mono font-bold text-zinc-700 dark:text-zinc-200')}>
            {(currentPercentage * 100).toFixed(0)}
            <span className='text-[0.6em]'>%</span>
          </span>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较：由于界面仅显示整数百分比 (toFixed(0))
    // 如果变化小于 0.01 (1%) 则认为无需重新启动动画，从而避免抖动
    return (
      Math.abs(prevProps.percentage - nextProps.percentage) < 0.01 &&
      prevProps.color === nextProps.color &&
      prevProps.size === nextProps.size &&
      prevProps.stroke === nextProps.stroke &&
      prevProps.fontSize === nextProps.fontSize
    );
  },
);

ConfidenceRing.displayName = 'ConfidenceRing';
