import {useEffect, useState} from 'react';
import {ExternalLink, Laptop, Moon, RefreshCw, SettingsIcon, Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';
import StreamPlayer from './components/StreamPlayer';
import SettingsPanel from './components/SettingsPanel.tsx';
import {FullRecommendationData} from './components/types.ts';
import './App.css'; // 确保引入 CSS

export default function App() {
    const [fullRecData, setFullRecData] = useState<FullRecommendationData | null>(null);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system');

    // DataServer 配置 (现在固定，如果需要修改可以通过 url query 或者 localStorage 手动改)
    const [protocol] = useState(() => localStorage.getItem('protocol') || 'http');
    const [backendAddress] = useState(() => localStorage.getItem('backendAddress') || '127.0.0.1:8765');

    const [clientId] = useState(() => {
        let id = localStorage.getItem('clientId');
        if (!id) {
            id = Math.random().toString(36).slice(2);
            localStorage.setItem('clientId', id);
        }
        return id;
    });

    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);

    const apiBase = `${protocol}://${backendAddress}`;
    const backendUrl = `${protocol}://${backendAddress}/sse?clientId=${clientId}`;

    const effectiveTheme = (() => {
        if (theme === 'system') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return theme;
    })();

    // --- Effects ---

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(effectiveTheme);
        localStorage.setItem('theme', theme);
    }, [theme, effectiveTheme]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            setTheme((prevTheme) => (prevTheme === 'system' ? 'system' : prevTheme));
        };
        if (theme === 'system') {
            mediaQuery.addEventListener('change', handleChange);
        }
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    useEffect(() => {
        if (!backendUrl) return;

        let currentSource: EventSource | null = null;
        let reconnectTimer: number | undefined;
        let stopped = false;
        let backoff = 1000;
        const maxBackoff = 30_000;

        const scheduleReconnect = () => {
            if (stopped || reconnectTimer) return;
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = undefined;
                backoff = Math.min(backoff * 2, maxBackoff);
                connect();
            }, backoff);
        };

        const connect = () => {
            if (stopped) return;

            if (currentSource) {
                currentSource.close();
                currentSource = null;
            }

            let es: EventSource;
            try {
                es = new EventSource(backendUrl);
            } catch (e) {
                console.error('Invalid SSE URL:', e);
                setError('配置错误');
                setIsConnected(false);
                scheduleReconnect();
                return;
            }

            currentSource = es;

            es.onopen = () => {
                console.log('SSE connected');
                setIsConnected(true);
                setError(null);
                backoff = 1000;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = undefined;
                }
            };

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data) {
                        setFullRecData(data.data);
                    }
                } catch (error) {
                    console.error('Failed to parse SSE message:', error);
                }
            };

            es.onerror = (event) => {
                console.error('SSE error:', event);
                setIsConnected(false);
                setError('连接断开');
                if (es.readyState === EventSource.CLOSED) {
                    scheduleReconnect();
                }
            };
        };

        connect();

        return () => {
            stopped = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (currentSource) {
                currentSource.close();
            }
        };
    }, [backendUrl]);

    // --- Handlers ---

    const handleOpenMajsoul = async () => {
        setIsLaunching(true);
        try {
            // 获取 Majsoul URL 配置
            const res = await fetch(`${apiBase}/api/settings`, {method: 'GET'});
            const body = await res.json();

            if (body?.ok && body?.data?.majsoul_url) {
                window.open(body.data.majsoul_url, '_blank');
            } else {
                alert('无法获取雀魂 URL，请检查设置。');
            }
        } catch (e) {
            console.error('Failed to fetch settings:', e);
            alert('连接服务器失败，无法打开雀魂。');
        } finally {
            setIsLaunching(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen text-zinc-900 dark:text-zinc-50 relative">

            {/* Header: 极简现代风格 */}
            <header
                className="sticky top-0 z-40 w-full backdrop-blur-lg bg-white/70 dark:bg-black/70 border-b border-zinc-200 dark:border-zinc-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

                    {/* Logo & Title */}
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-2.5 h-2.5 rounded-full shadow-sm transition-colors duration-500 ${isConnected ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-rose-500 shadow-rose-500/50 animate-pulse'}`}/>
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-violet-600 dark:from-pink-400 dark:to-violet-400">
                            Akagi Next-Generation
                        </h1>
                        {error && (
                            <span
                                className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded ml-2 hidden sm:inline-block">
                                {error}
                            </span>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hidden sm:flex"
                            onClick={handleOpenMajsoul}
                            disabled={isLaunching}
                        >
                            {isLaunching ? <RefreshCw className="mr-2 h-4 w-4 animate-spin"/> :
                                <ExternalLink className="mr-2 h-4 w-4"/>}
                            启动雀魂
                        </Button>

                        {/* Theme Toggle Group */}
                        <div
                            className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-full p-1 border border-zinc-200 dark:border-zinc-700">
                            <button
                                onClick={() => setTheme('light')}
                                className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white dark:bg-zinc-600 shadow-sm text-amber-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                            >
                                <Sun className="w-4 h-4"/>
                            </button>
                            <button
                                onClick={() => setTheme('dark')}
                                className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-white dark:bg-zinc-600 shadow-sm text-indigo-400' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                            >
                                <Moon className="w-4 h-4"/>
                            </button>
                            <button
                                onClick={() => setTheme('system')}
                                className={`p-1.5 rounded-full transition-all ${theme === 'system' ? 'bg-white dark:bg-zinc-600 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                            >
                                <Laptop className="w-4 h-4"/>
                            </button>
                        </div>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSettingsOpen(true)}
                            className="ml-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                            <SettingsIcon className="h-5 w-5"/>
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main
                className="flex-grow w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-8 flex flex-col items-center justify-start gap-8">

                {/* 状态栏：移动端显示错误信息 */}
                {error && (
                    <div
                        className="w-full sm:hidden p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg text-sm text-center border border-rose-100 dark:border-rose-900/50">
                        ⚠️ {error} - 请检查后端连接
                    </div>
                )}

                {/* 播放器容器 */}
                <div className="w-full">
                    <StreamPlayer data={fullRecData}/>
                </div>

                {/* 移动端启动按钮 (Header上隐藏时显示) */}
                <div className="sm:hidden w-full">
                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleOpenMajsoul}
                    >
                        <ExternalLink className="mr-2 h-4 w-4"/>
                        启动雀魂 (Majsoul)
                    </Button>
                </div>

            </main>

            {/* Footer */}
            <footer
                className="mt-auto border-t border-zinc-200/50 dark:border-zinc-800/50
             py-4 text-center text-xs text-zinc-400 dark:text-zinc-600
             backdrop-blur-sm"
            >
                <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-3">
                    <span>Akagi NG</span>
                    <span className="hidden sm:inline">•</span>
                    <a
                        href="https://www.dongzhenxian.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                    >
                        by Xe-Persistent
                    </a>
                    <span className="hidden sm:inline">•</span>
                    <a
                        href="https://github.com/Xe-Persistent/Akagi-NG"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                    >
                        GitHub
                    </a>
                    <span className="hidden sm:inline">•</span>
                    <a
                        href="https://github.com/Xe-Persistent/Akagi-NG/blob/master/LICENSE"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                    >
                        GPL-3.0
                    </a>
                </div>
            </footer>

            <SettingsPanel
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                apiBase={apiBase}
            />
        </div>
    );
}