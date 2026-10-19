import { getTranslations } from 'next-intl/server';
import { Button, Container } from '@/components/ui';

/** 404 внутри локали (notFound() в странице или неизвестный курс). */
export default async function LocaleNotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <section className="oops" aria-labelledby="oops-title">
      <Container>
        <div className="oops__copy">
          <h1 id="oops-title" className="display oops__title">
            {t('title')}
          </h1>
          <p className="lead">{t('description')}</p>
          <div className="oops__actions">
            <Button href="/courses" variant="primary" size="lg">
              {t('courses')}
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
