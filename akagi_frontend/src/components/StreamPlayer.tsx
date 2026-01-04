import type {FC} from 'react';
import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button.tsx';
import {Loader2, PictureInPicture2} from 'lucide-react';
import StreamRenderComponent from './StreamRenderComponent.tsx';
import type {FullRecommendationData} from './types.ts';

// 类型声明扩展
declare global {
    interface Window {
        documentPictureInPicture?: {
            requestWindow(options: { width: number; height: number }): Promise<Window>;
            window: Window | null;
            onenter: ((this: EventTarget, ev: Event) => void) | null;
        };
    }
}

interface StreamPlayerProps {
    data: FullRecommendationData | null;
}

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
                    flexShrink: 0
                }}
            >
                <StreamRenderComponent data={data}/>
            </div>
        </div>
    );
};

const StreamPlayer: FC<StreamPlayerProps> = ({data}) => {
    // 状态管理
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // 自动缩放状态
    const [scale, setScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    // ==========================================
    // 自动缩放逻辑 (网页模式)
    // ==========================================
    useLayoutEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const {width} = containerRef.current.getBoundingClientRect();
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
    // Document Picture-in-Picture
    // ==========================================
    const startDocumentPiP = async () => {
        if (!window.documentPictureInPicture) {
            alert("Your browser does not support Document Picture-in-Picture API.");
            return;
        }

        try {
            setIsLoading(true);
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

            // 使用 Flex 布局 + 100% 高度确保内容被正确包含且居中
            pipWin.document.getElementsByTagName('html')[0].style.height = '100%';

            Object.assign(pipWin.document.body.style, {
                margin: "0",
                padding: "0",
                height: "100%",
                width: "100%",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: document.documentElement.className.includes('dark') ? '#09090b' : '#fafafa',
            });

            pipWin.addEventListener('pagehide', () => {
                setPipWindow(null);
            });

            setPipWindow(pipWin);
        } catch (err) {
            console.error('Failed to open Document PiP:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePipClick = () => {
        if (pipWindow) {
            pipWindow.close();
        } else {
            void startDocumentPiP();
        }
    };

    return (
        <div className="flex flex-col items-center gap-6 w-full">
            {/* 1. 主显示区域 */}
            <div
                ref={containerRef}
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
                    className="transition-transform duration-100 ease-linear shrink-0"
                >
                    <StreamRenderComponent data={data}/>
                </div>

                {/* 状态遮罩 */}
                {!!pipWindow && (
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
                        ${pipWindow
                        ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 ring-1 ring-zinc-200 dark:ring-zinc-700'
                        : 'bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-indigo-500/25'
                    }
                    `}
                >
                    <div className="relative z-10 flex items-center gap-3 text-base font-medium">
                        {isLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin"/>
                        ) : (
                            <PictureInPicture2
                                className={`h-5 w-5 ${pipWindow ? '' : 'animate-pulse'}`}/>
                        )}
                        <span>
                            {isLoading ? '正在启动...' : (pipWindow ? '退出画中画模式' : '开启画中画模式')}
                        </span>
                    </div>
                </Button>
            </div>

            {/* A. Document PiP 的内容 */}
            {pipWindow && createPortal(<PiPContent data={data} pipWin={pipWindow}/>, pipWindow.document.body)}
        </div>
    );
};

export default StreamPlayer;