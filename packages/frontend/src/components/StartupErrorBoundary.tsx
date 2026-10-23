import { CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { requestShutdown } from '@/api/desktop';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export function StartupErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  const exitApp = () => {
    if (!window.electron) {
      window.close();
      return;
    }
    void requestShutdown().catch(() => window.close());
  };

  return (
    <ErrorBoundary
      fallback={(error: Error) => (
        <div className='flex min-h-screen w-full flex-col items-center justify-center bg-background p-8 text-center tracking-tight text-foreground'>
          <CircleX className='mb-4 h-10 w-10 text-destructive' />
          <h3 className='mb-2 text-lg font-semibold text-destructive'>{t('app.startup_failed')}</h3>
          <p className='mb-4 max-w-lg text-sm whitespace-pre-wrap text-muted-foreground'>
            {error.message || String(error)}
          </p>
          <Button onClick={exitApp}>{t('common.exit_app')}</Button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
