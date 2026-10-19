import { getTranslations } from 'next-intl/server';
import { Button, Circles, Container, Eyebrow } from '@/components/ui';

/** 404 внутри локали (notFound() в странице или неизвестный курс). */
export default async function LocaleNotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <section className="oops on-night" aria-labelledby="oops-title">
      <Circles className="oops__rings" />
      <Container>
        <div className="oops__copy">
          <p className="display oops__code" aria-hidden="true">
            404
          </p>
          <Eyebrow variant="dot">{t('eyebrow')}</Eyebrow>
          <h1 id="oops-title" className="display oops__title">
            {t('title')}
          </h1>
          <p className="lead oops__lead">{t('description')}</p>
          <div className="oops__actions">
            <Button href="/courses" variant="primary" size="lg">
              {t('courses')}
            </Button>
            <Button href="/" variant="ghost" size="lg">
              {t('home')}
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
