import { useTranslation } from 'react-i18next';

export function ExitOverlay() {
  const { t } = useTranslation();

  return (
    <div className='animate-in fade-in fixed inset-0 z-9999 flex h-screen flex-col items-center justify-center bg-white/30 backdrop-blur-xl duration-500 dark:bg-zinc-950/30'>
      <div className='relative mb-8'>
        <div className='logo-glow-effect' />
        <img
          src='torii.svg'
          alt='Akagi Logo'
          className='relative h-24 w-24 drop-shadow-lg lg:h-32 lg:w-32'
        />
      </div>
      <h1 className='mb-4 text-3xl font-bold tracking-tight text-rose-500 lg:text-4xl'>
        {t('app.stopped_title')}
      </h1>
      <p className='text-muted-foreground text-lg font-medium'>{t('app.stopped_desc')}</p>
    </div>
  );
}
