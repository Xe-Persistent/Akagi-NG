import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import html2canvas from 'html2canvas';
import {Button} from '@/components/ui/button.tsx';
import {Loader2, PictureInPicture2} from 'lucide-react';
import StreamRenderComponent from './StreamRenderComponent.tsx';
import {FullRecommendationData} from './types.ts';

// 类型声明扩展
declare global {
    interface Window {
        documentPictureInPicture?: {
            requestWindow(options: { width: number; height: number }): Promise<Window>;
            window: Window | null;
            onenter: ((this: EventTarget, ev: Event) => any) | null;
        };
        gc?: () => void;
    }
}

interface StreamPlayerProps {
    data: FullRecommendationData | null;
}

const StreamPlayer: React.FC<StreamPlayerProps> = ({data}) => {
    // 状态管理
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const [isFallbackPipActive, setIsFallbackPipActive] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // 自动缩放状态
    const [scale, setScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    // Fallback 模式所需的引用
    const fallbackSourceRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const reqIdRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // ==========================================
    // 自动缩放逻辑 (网页模式)
    // ==========================================
    useLayoutEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const {width} = containerRef.current.getBoundingClientRect();
                // 允许放大到 1.0 (1280px)，如果屏幕足够大。
                // 如果屏幕小，就按比例缩小。
                // 只有当容器比 1280 小的时候才缩小，否则保持 1 (不放大超过原始清晰度，或者你可以选择 width / 1280 允许无限放大)
                // 这里我们设定：最大 1.0，因为原件就是 1280，放大可能会糊，但缩小必须支持
                // 如果你希望在超大屏上也能铺满，可以去掉 Math.min(..., 1)
                const newScale = Math.min(width / 1280, 1);
                setScale(newScale);
            }
        };

        // 初始化
        updateScale();
        const observer = new ResizeObserver(updateScale);
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        return () => observer.disconnect();
    }, []);

    // ==========================================
    // PiP 窗口内的自动缩放逻辑
    // ==========================================
    const PiPContent = ({data, pipWin}: { data: FullRecommendationData | null, pipWin: Window }) => {
        const [pipScale, setPipScale] = useState(1);

        useLayoutEffect(() => {
            const handleResize = () => {
                if (!pipWin) return;

                // 获取 PiP 窗口的实际尺寸
                const width = pipWin.innerWidth;
                const height = pipWin.innerHeight;

                // 计算保持 16:9 比例的缩放值
                const scaleX = width / 1280;
                const scaleY = height / 720;

                // 取较小值以确保内容完全包含在窗口内 (contain模式)
                // 并且不限制最大值，允许放大超过 1.0
                setPipScale(Math.min(scaleX, scaleY));
            };

            // 监听 PiP 窗口的大小变化
            pipWin.addEventListener('resize', handleResize);
            handleResize(); // 初始化

            return () => pipWin.removeEventListener('resize', handleResize);
        }, [pipWin]);

        return (
            <div className="w-full h-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
                <div
                    style={{
                        transform: `scale(${pipScale})`,
                        transformOrigin: 'center center',
                        width: 1280,
                        height: 720,
                        flexShrink: 0 // 防止被 flexbox 压缩
                    }}
                >
                    <StreamRenderComponent data={data}/>
                </div>
            </div>
        );
    };


    // ==========================================
    // 策略 1: Document Picture-in-Picture (现代浏览器)
    // ==========================================
    const startDocumentPiP = async () => {
        if (!window.documentPictureInPicture) return;

        try {
            // 请求 1280x720 的窗口
            const pipWin = await window.documentPictureInPicture.requestWindow({
                width: 1280,
                height: 720,
            });

            // 复制样式
            const styles = document.querySelectorAll('link[rel="stylesheet"], style');
            styles.forEach((style) => {
                pipWin.document.head.appendChild(style.cloneNode(true));
            });
            // 复制 Root Class (Tailwind Dark Mode)
            pipWin.document.documentElement.className = document.documentElement.className;

            pipWin.addEventListener('pagehide', () => {
                setPipWindow(null);
            });

            setPipWindow(pipWin);
        } catch (err) {
            console.error('Failed to open Document PiP:', err);
        }
    };

    // ==========================================
    // 策略 2: Canvas + Video PiP (兼容模式)
    // ==========================================
    // ... 代码与之前保持一致，只展示关键部分 ...
    useEffect(() => {
        if (!isFallbackPipActive || !fallbackSourceRef.current || !canvasRef.current) {
            if (reqIdRef.current) {
                cancelAnimationFrame(reqIdRef.current);
                reqIdRef.current = null;
            }
            return;
        }

        const source = fallbackSourceRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        let isRendering = false;

        const renderLoop = async () => {
            if (!isFallbackPipActive) return;
            if (isRendering) {
                reqIdRef.current = requestAnimationFrame(renderLoop);
                return;
            }

            try {
                isRendering = true;
                // 确保 Canvas 截图也是完整的 1280x720
                const tempCanvas = await html2canvas(source, {
                    useCORS: true, allowTaint: false, backgroundColor: null, scale: 1, logging: false,
                    width: 1280, height: 720,
                });
                if (ctx && isFallbackPipActive) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(tempCanvas, 0, 0);
                }
            } catch (err) {
                console.warn('Render error:', err);
            } finally {
                isRendering = false;
                if (isFallbackPipActive) reqIdRef.current = requestAnimationFrame(renderLoop);
            }
        };
        reqIdRef.current = requestAnimationFrame(renderLoop);
        return () => {
            if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
        };
    }, [isFallbackPipActive, data]);

    const startFallbackPiP = async () => {
        if (!videoRef.current || !canvasRef.current) return;
        try {
            setIsLoading(true);
            setIsFallbackPipActive(true);
            await new Promise(resolve => setTimeout(resolve, 100));
            const stream = canvasRef.current.captureStream(30);
            streamRef.current = stream;
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            await videoRef.current.requestPictureInPicture();
            videoRef.current.addEventListener('leavepictureinpicture', () => {
                setIsFallbackPipActive(false);
                if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
                videoRef.current!.srcObject = null;
            }, {once: true});
        } catch (error) {
            console.error('Fallback PiP failed:', error);
            setIsFallbackPipActive(false);
            alert('启动画中画失败');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePipClick = () => {
        if (pipWindow) {
            pipWindow.close();
        } else if (isFallbackPipActive) {
            document.exitPictureInPicture();
        } else {
            if ('documentPictureInPicture' in window) {
                startDocumentPiP();
            } else {
                startFallbackPiP();
            }
        }
    };

    return (
        // 关键修复 1: 移除 max-w-6xl，改为 w-full，允许容器尽可能大
        <div className="flex flex-col items-center gap-6 w-full">
            {/* 1. 主显示区域 */}
            <div
                ref={containerRef}
                // 关键修复 2: 保持 16/9 比例，但不再限制最大宽度，完全依赖父级布局
                className="relative w-full aspect-video bg-zinc-100/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex items-center justify-center shadow-lg group"
            >
                {/* 缩放容器 */}
                <div
                    style={{
                        transform: `scale(${scale})`,
                        width: 1280,
                        height: 720,
                        transformOrigin: 'center center',
                    }}
                    className="transition-transform duration-100 ease-linear flex-shrink-0"
                >
                    <StreamRenderComponent data={data}/>
                </div>

                {/* 状态遮罩 */}
                {(!!pipWindow || isFallbackPipActive) && (
                    <div
                        className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm flex flex-col items-center justify-center text-white z-10 transition-all duration-300">
                        <div className="bg-white/10 p-4 rounded-full mb-4 ring-1 ring-white/20">
                            <PictureInPicture2 className="w-8 h-8 opacity-90"/>
                        </div>
                        <p className="font-medium text-lg tracking-wide">正在画中画模式播放</p>
                        <p className="text-sm text-zinc-300 mt-2">你可以切换到其他标签页继续浏览</p>
                    </div>
                )}
            </div>

            {/* 控制栏 */}
            <div className="flex items-center justify-center w-full">
                <Button
                    onClick={handlePipClick}
                    disabled={isLoading}
                    className={`
                        relative overflow-hidden transition-all duration-300 transform hover:scale-105 active:scale-95
                        px-8 py-6 rounded-xl shadow-lg hover:shadow-xl
                        ${pipWindow || isFallbackPipActive
                        ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 ring-1 ring-zinc-200 dark:ring-zinc-700'
                        : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-indigo-500/25'
                    }
                    `}
                >
                    <div className="relative z-10 flex items-center gap-3 text-base font-medium">
                        {isLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin"/>
                        ) : (
                            <PictureInPicture2
                                className={`h-5 w-5 ${pipWindow || isFallbackPipActive ? '' : 'animate-pulse'}`}/>
                        )}
                        <span>
                            {isLoading ? '正在启动...' : (pipWindow || isFallbackPipActive ? '退出画中画模式' : '开启画中画模式')}
                        </span>
                    </div>
                </Button>
            </div>

            {/* A. Document PiP 的内容 */}
            {pipWindow && createPortal(<PiPContent data={data} pipWin={pipWindow}/>, pipWindow.document.body)}

            {/* B. Fallback PiP 的离屏渲染源 */}
            <div className="fixed left-[-9999px] top-[-9999px]">
                <div ref={fallbackSourceRef}><StreamRenderComponent data={data}/></div>
                <canvas ref={canvasRef} width="1280" height="720"/>
                <video ref={videoRef} muted playsInline className="w-[1280px] h-[720px]"/>
            </div>
        </div>
    );
};

export default StreamPlayer;