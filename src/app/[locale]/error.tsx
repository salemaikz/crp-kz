'use client';

import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Circles, Container, Eyebrow } from '@/components/ui';

type Props = { error: unknown; retry: () => void };

/** Ошибка рендера страницы: объясняем и даём повторить. */
export default function LocaleError({ error, retry }: Props) {
  const t = useTranslations('common.error');
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest?: unknown }).digest ?? '') : '';

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="oops on-night" aria-labelledby="oops-title">
      <Circles className="oops__rings" />
      <Container>
        <div className="oops__copy">
          <Eyebrow variant="dot">{t('eyebrow')}</Eyebrow>
          <h1 id="oops-title" className="display oops__title">
            {t('title')}
          </h1>
          <p className="lead oops__lead">{t('description')}</p>
          <div className="oops__actions">
            <Button variant="primary" size="lg" onClick={() => retry()}>
              <RotateCw aria-hidden="true" />
              {t('retry')}
            </Button>
            <Button href="/" variant="ghost" size="lg">
              {t('home')}
            </Button>
          </div>
          {digest && <p className="oops__digest">{t('code', { digest })}</p>}
        </div>
      </Container>
    </section>
  );
}
