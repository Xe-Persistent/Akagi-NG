import {useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import StreamPlayer from './components/StreamPlayer';
import SettingsPanel from './components/SettingsPanel.tsx';
import {useTheme} from '@/hooks/useTheme';
import {useSSEConnection} from '@/hooks/useSSEConnection';
import {Header} from '@/components/layout/Header';
import {Footer} from '@/components/layout/Footer';
import './App.css';

export default function App() {
    // Hooks
    const {theme, setTheme} = useTheme();

    // DataServer 配置
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

    const apiBase = `${protocol}://${backendAddress}`;
    const backendUrl = `${protocol}://${backendAddress}/sse?clientId=${clientId}`;

    const {data: fullRecData, isConnected, error} = useSSEConnection(backendUrl);

    // UI States
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);

    // Handlers
    const handleOpenMajsoul = async () => {
        setIsLaunching(true);
        try {
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

            <Header
                theme={theme}
                setTheme={setTheme}
                isConnected={isConnected}
                error={error}
                isLaunching={isLaunching}
                onLaunch={handleOpenMajsoul}
                onOpenSettings={() => setSettingsOpen(true)}
            />

            <main
                className="grow w-full max-w-350 mx-auto px-4 sm:px-6 py-8 flex flex-col items-center justify-start gap-8">
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
                    <Button variant="outline" className="w-full" onClick={handleOpenMajsoul}>
                        <ExternalLink className="mr-2 h-4 w-4"/>
                        启动雀魂 (Majsoul)
                    </Button>
                </div>
            </main>

            <Footer/>

            <SettingsPanel
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                apiBase={apiBase}
            />
        </div>
    );
}