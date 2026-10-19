import Image from 'next/image';
import { Award, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Circles, Container, Mark, ProgressBar, Stat } from '@/components/ui';
import type { CatalogStats } from '@/lib/catalog/queries';
import { formatNumber } from '@/lib/format';
import '../catalog.css';

type Props = { stats: CatalogStats; loggedIn: boolean; locale: string };

/** Первый экран: «ночь» с красным свечением и кольцами, заголовок с рукописным подчёркиванием, цифры. */
export function HomeHero({ stats, loggedIn, locale }: Props) {
  const t = useTranslations('catalog.home');
  return (
    <section className="cat-hero on-night" aria-labelledby="home-title">
      <Circles className="cat-hero__rings" />
      <Container className="cat-hero__grid">
        <div className="cat-hero__copy">
          <h1 id="home-title" className="display cat-hero__title">
            {t.rich('hero.title', { mark: (chunks) => <Mark>{chunks}</Mark> })}
          </h1>
          <p className="cat-hero__lead">{t('hero.lead')}</p>
          <div className="cat-hero__actions">
            <Button href="/courses" variant="primary" size="lg">
              {t('hero.chooseCourse')}
            </Button>
            {loggedIn ? (
              <Button href="/learn" variant="ghost" size="lg">
                {t('hero.myLearning')}
              </Button>
            ) : (
              <Button href="/login" variant="ghost" size="lg">
                {t('hero.login')}
              </Button>
            )}
          </div>
          <div className="cat-hero__proof">
            <Stat
              size="sm"
              value={formatNumber(stats.courses, locale)}
              label={t('proof.courses', { count: stats.courses })}
            />
            <Stat
              size="sm"
              value={formatNumber(stats.lessons, locale)}
              label={t('proof.lessons', { count: stats.lessons })}
            />
            <Stat size="sm" value={t('proof.certificateValue')} label={t('proof.certificate')} />
          </div>
        </div>

        <div className="cat-visual" aria-hidden="true">
          <div className="cat-visual__frame">
            <Image
              src="/brand/hero-rocket.webp"
              alt=""
              fill
              priority
              sizes="(min-width: 960px) 540px, calc(100vw - 32px)"
              className="cat-visual__img"
            />
          </div>
          <div className="cat-float cat-float--lesson">
            <span className="cat-float__title">{t('hero.visualLesson')}</span>
            <ProgressBar size="sm" value={31} label={t('hero.visualProgress')} hideLabel showValue={false} />
          </div>
          <div className="cat-float cat-float--quiz">
            <CircleCheck />
            <span>
              <span className="cat-float__title">{t('hero.visualQuiz')}</span>
              <span className="cat-float__hint">{t('hero.visualQuizResult')}</span>
            </span>
          </div>
          <div className="cat-float cat-float--cert">
            <Award />
            <span>
              <span className="cat-float__title">{t('hero.visualCertificate')}</span>
              <span className="cat-float__hint">{t('hero.visualCertificateHint')}</span>
            </span>
          </div>
        </div>
      </Container>
    </section>
  );
}
