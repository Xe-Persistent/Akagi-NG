import type {FC} from 'react';

export const Footer: FC = () => {
    return (
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
                    AGPLv3
                </a>
            </div>
        </footer>
    );
};
