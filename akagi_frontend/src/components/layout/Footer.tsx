import { type FC, memo } from 'react';

import { AKAGI_VERSION } from '@/version';

export const Footer: FC = memo(() => {
  return (
    <footer className='mt-auto border-t border-zinc-200/50 py-4 text-center text-xs text-zinc-400 backdrop-blur-sm dark:border-zinc-800/50 dark:text-zinc-600'>
      <div className='flex flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-3'>
        <span>Akagi NG</span>
        <span className='hidden sm:inline'>•</span>
        <span>v{AKAGI_VERSION}</span>
        <span className='hidden sm:inline'>•</span>
        <a
          href='https://github.com/Xe-Persistent/Akagi-NG'
          target='_blank'
          rel='noopener noreferrer'
          className='transition-colors hover:text-zinc-600 dark:hover:text-zinc-400'
        >
          GitHub
        </a>
        <span className='hidden sm:inline'>•</span>
        <a
          href='https://github.com/Xe-Persistent/Akagi-NG/blob/master/LICENSE'
          target='_blank'
          rel='noopener noreferrer'
          className='transition-colors hover:text-zinc-600 dark:hover:text-zinc-400'
        >
          AGPLv3
        </a>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';
