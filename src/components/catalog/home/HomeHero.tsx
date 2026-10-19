import { useTranslations } from 'next-intl';
import { Button, Circles, Container, Mark } from '@/components/ui';
import '../catalog.css';

type Props = { loggedIn: boolean };

/**
 * Первый экран главной: тёмный фон с красным свечением, кольца справа (мотив знака ЦРП),
 * заголовок-факт с линией-маркером под одним словом, лид, две кнопки. Больше нигде кольца не рисуем.
 */
export function HomeHero({ loggedIn }: Props) {
  const t = useTranslations('catalog.home.hero');
  return (
    <section className="cat-hero on-night" aria-labelledby="home-title">
      <Circles animated={false} className="cat-hero__rings" />
      <Container className="cat-hero__inner">
        <div className="cat-hero__copy">
          <h1 id="home-title" className="display cat-hero__title">
            {t.rich('title', { mark: (chunks) => <Mark>{chunks}</Mark> })}
          </h1>
          <p className="cat-hero__lead">{t('lead')}</p>
          <div className="cat-hero__actions">
            <Button href="/courses" variant="primary" size="lg">
              {t('chooseCourse')}
            </Button>
            {loggedIn ? (
              <Button href="/learn" variant="ghost" size="lg">
                {t('myLearning')}
              </Button>
            ) : (
              <Button href="/login" variant="ghost" size="lg">
                {t('login')}
              </Button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
