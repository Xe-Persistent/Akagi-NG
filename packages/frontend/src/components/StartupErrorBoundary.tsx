import { CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export function StartupErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <ErrorBoundary
      fallback={(error: Error) => (
        <div className='bg-background text-foreground flex min-h-screen w-full flex-col items-center justify-center p-8 text-center tracking-tight'>
          <CircleX className='text-destructive mb-4 h-10 w-10' />
          <h3 className='text-destructive mb-2 text-lg font-semibold'>{t('app.startup_failed')}</h3>
          <p className='text-muted-foreground mb-4 max-w-lg text-sm whitespace-pre-wrap'>
            {error.message || String(error)}
          </p>
          <Button
            onClick={() => {
              return (
                window.electron?.invoke('request-shutdown').catch(() => window.close()) ??
                window.close()
              );
            }}
          >
            {t('common.exit_app')}
          </Button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
