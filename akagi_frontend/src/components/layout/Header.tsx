import type {FC} from 'react';
import {ExternalLink, Laptop, Moon, RefreshCw, SettingsIcon, Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface HeaderProps {
    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    isConnected: boolean;
    error: string | null;
    isLaunching: boolean;
    onLaunch: () => void;
    onOpenSettings: () => void;
}

export const Header: FC<HeaderProps> = ({
                                            theme,
                                            setTheme,
                                            isConnected,
                                            error,
                                            isLaunching,
                                            onLaunch,
                                            onOpenSettings,
                                        }) => {
    return (
        <header
            className="sticky top-0 z-40 w-full backdrop-blur-lg bg-white/70 dark:bg-black/70 border-b border-zinc-200 dark:border-zinc-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

                {/* Logo & Title */}
                <div className="flex items-center gap-3">
                    <div
                        className={`w-2.5 h-2.5 rounded-full shadow-sm transition-colors duration-500 ${isConnected ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-rose-500 shadow-rose-500/50 animate-pulse'}`}/>
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-pink-600 to-violet-600 dark:from-pink-400 dark:to-violet-400">
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
                        onClick={onLaunch}
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
                        onClick={onOpenSettings}
                        className="ml-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                        <SettingsIcon className="h-5 w-5"/>
                    </Button>
                </div>
            </div>
        </header>
    );
};
