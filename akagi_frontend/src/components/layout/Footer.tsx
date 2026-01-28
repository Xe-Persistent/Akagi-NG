import { Github, Scale } from 'lucide-react';
import { type FC, memo } from 'react';

import { AKAGI_VERSION } from '@/version';

export const Footer: FC = memo(() => {
  return (
    <footer className='mt-12 w-full py-8 text-center'>
      <div className='mx-auto max-w-7xl px-4'>
        <div className='flex flex-col items-center justify-center gap-4 text-zinc-500 dark:text-zinc-400'>
          <div className='flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm'>
            <span className='font-semibold tracking-wide text-zinc-500 dark:text-zinc-400'>
              Akagi-NG
            </span>

            <span className='inline-flex items-center rounded-full border border-zinc-500/20 bg-transparent px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:border-zinc-400/20 dark:text-zinc-400'>
              v{AKAGI_VERSION}
            </span>

            <div className='flex items-center gap-4'>
              <a
                href='https://github.com/Xe-Persistent/Akagi-NG'
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-1.5 opacity-70 transition-opacity hover:text-zinc-900 hover:opacity-90 dark:hover:text-zinc-100'
              >
                <Github className='h-4 w-4' />
                <span>GitHub</span>
              </a>

              <a
                href='https://github.com/Xe-Persistent/Akagi-NG/blob/master/LICENSE'
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-1.5 opacity-70 transition-opacity hover:text-zinc-900 hover:opacity-90 dark:hover:text-zinc-100'
              >
                <Scale className='h-4 w-4' />
                <span>AGPLv3</span>
              </a>
            </div>
          </div>

          <p className='text-[10px] opacity-40'>
            © {new Date().getFullYear()} Akagi-NG contributors.
          </p>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';
