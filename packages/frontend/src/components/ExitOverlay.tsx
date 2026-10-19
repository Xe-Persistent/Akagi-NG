import { useTranslation } from 'react-i18next';

export function ExitOverlay() {
  const { t } = useTranslation();

  return (
    <div className='animate-in fade-in-0 z-critical fixed inset-0 flex flex-col items-center justify-center bg-white/30 backdrop-blur-xl duration-500 dark:bg-zinc-950/30'>
      <div className='relative mb-8'>
        <div className='logo-glow-effect' />
        <img src='torii.svg' alt='Akagi Logo' className='relative h-32 w-32 drop-shadow-lg' />
      </div>
      <h1 className='mb-4 text-4xl font-bold tracking-tight text-rose-500'>
        {t('app.stopped_title')}
      </h1>
      <p className='text-muted-foreground text-lg font-medium'>{t('app.stopped_desc')}</p>
    </div>
  );
}
