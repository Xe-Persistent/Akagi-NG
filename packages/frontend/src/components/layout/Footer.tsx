import { AppWindow, Scale } from 'lucide-react';
import type { ReactNode } from 'react';

import { AKAGI_VERSION } from '@/version';

import { UpdateBadge } from './UpdateBadge';

function ExternalLink({ href, icon, text }: { href: string; icon: ReactNode; text: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        window.electron.invoke('open-external', href);
      }}
      className='flex items-center gap-1.5 opacity-60 transition-opacity hover:opacity-100'
    >
      {icon}
      <span>{text}</span>
    </a>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer className='flex h-6 items-center justify-center gap-4 px-4 text-xs text-zinc-500 dark:text-zinc-400'>
      <span className='font-semibold tracking-wide'>Akagi-NG</span>
      <div className='flex items-center gap-2'>
        <span className='opacity-40'>v{AKAGI_VERSION}</span>
        <UpdateBadge />
      </div>
      <div className='h-3 w-px bg-zinc-300 dark:bg-zinc-700' />
      <ExternalLink
        href='https://github.com/Xe-Persistent/Akagi-NG'
        icon={<AppWindow className='h-3.5 w-3.5' />}
        text='Homepage'
      />
      <ExternalLink
        href='https://github.com/Xe-Persistent/Akagi-NG?tab=AGPL-3.0-1-ov-file'
        icon={<Scale className='h-3.5 w-3.5' />}
        text='License'
      />
      <div className='h-3 w-px bg-zinc-300 dark:bg-zinc-700' />
      <span className='opacity-30'>© {CURRENT_YEAR} Akagi-NG contributors.</span>
    </footer>
  );
}
