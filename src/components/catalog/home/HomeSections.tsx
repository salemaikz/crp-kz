import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, Container, EmptyState, Eyebrow, LinkArrow, Section } from '@/components/ui';
import { CRP_CONTACTS } from '@/lib/brand';
import type { CatalogCourse, ViewerCourseState } from '@/lib/catalog/types';
import type { Locale } from '@/lib/content/types';
import { CourseCard } from '../CourseCard';
import '../catalog.css';

/** Витрина: первые публичные курсы. */
export function FeaturedCourses({
  courses,
  locale,
  states,
}: {
  courses: CatalogCourse[];
  locale: Locale;
  states?: Map<string, ViewerCourseState>;
}) {
  const t = useTranslations('catalog.home.featured');
  return (
    <Section tone="board" aria-labelledby="featured-title">
      <Container>
        <div className="section-head section-head--split">
          <div className="cat-head">
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 id="featured-title" className="display h2">
              {t('title')}
            </h2>
            <p className="lead">{t('lead')}</p>
          </div>
          <LinkArrow href="/courses">{t('all')}</LinkArrow>
        </div>
        {courses.length > 0 ? (
          <div className="cat-grid">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} locale={locale} state={states?.get(course.id)} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('emptyTitle')} description={t('emptyText')} />
        )}
      </Container>
    </Section>
  );
}

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

/** «Как проходит обучение»: четыре шага на ночной секции, как «От разбора до результата» на сайте. */
export function HowItWorks() {
  const t = useTranslations('catalog.home.steps');
  return (
    <Section tone="night" aria-labelledby="steps-title">
      <Container>
        <div className="section-head">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2 id="steps-title" className="display h2">
            {t('title')}
          </h2>
        </div>
        <ol className="cat-steps">
          {STEPS.map((key) => (
            <li key={key} className="cat-step">
              <span className="cat-step__label">{t(`${key}.label`)}</span>
              <h3 className="cat-step__title">{t(`${key}.title`)}</h3>
              <p className="cat-step__text">{t(`${key}.text`)}</p>
              <span className="cat-step__tag">{t(`${key}.tag`)}</span>
            </li>
          ))}
        </ol>
        <div className="cat-steps__cta">
          <Button href="/courses" variant="primary" size="lg">
            {t('cta')}
          </Button>
          <p>{t('note')}</p>
        </div>
      </Container>
    </Section>
  );
}

export type TeamsViewer = 'guest' | 'user' | 'manager';

/** «Для команд и компаний»: обучение сотрудников ЦРП (ссылка на «Команду» для руководителей) и B2B «скоро». */
export function TeamsBlock({ viewer, locale }: { viewer: TeamsViewer; locale: Locale }) {
  const t = useTranslations('catalog.home.teams');
  return (
    <Section tone="paper" rings aria-labelledby="teams-title">
      <Container>
        <div className="section-head">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2 id="teams-title" className="display h2">
            {t('title')}
          </h2>
          <p className="lead">{t('lead')}</p>
        </div>
        <div className="cat-teams">
          <Card large padding="lg" className="cat-team">
            <h3 className="h3">{t('staff.title')}</h3>
            <p className="muted">{t('staff.text')}</p>
            <ul className="cat-checks">
              {(['point1', 'point2', 'point3'] as const).map((k) => (
                <li key={k}>
                  <Check aria-hidden="true" />
                  {t(`staff.${k}`)}
                </li>
              ))}
            </ul>
            {viewer === 'manager' && (
              <Button href="/team" variant="primary">
                {t('staff.open')}
              </Button>
            )}
            {viewer === 'guest' && (
              <Button href={`/login?next=/${locale}/team`} variant="ghost">
                {t('staff.loginAsManager')}
              </Button>
            )}
          </Card>
          <Card large padding="lg" tone="dashed" className="cat-team">
            <div className="cat-team__head">
              <h3 className="h3">{t('clients.title')}</h3>
              <Badge tone="neutral">{t('clients.badge')}</Badge>
            </div>
            <p className="muted">{t('clients.text')}</p>
            <ul className="cat-checks">
              {(['point1', 'point2', 'point3'] as const).map((k) => (
                <li key={k}>
                  <Check aria-hidden="true" />
                  {t(`clients.${k}`)}
                </li>
              ))}
            </ul>
            <Button href={CRP_CONTACTS.phoneHref} variant="ghost">
              {t('clients.contact')}
            </Button>
          </Card>
        </div>
      </Container>
    </Section>
  );
}

/** Финальный призыв: ночная секция со свечением. */
export function FinalCta() {
  const t = useTranslations('catalog.home.final');
  return (
    <Section tone="night" glow spacing="tight" aria-labelledby="final-title">
      <Container>
        <div className="cat-final">
          <div className="cat-final__copy">
            <h2 id="final-title" className="display h2">
              {t('title')}
            </h2>
            <p className="lead">{t('lead')}</p>
          </div>
          <div className="cat-final__actions">
            <Button href="/courses?f=free" variant="primary" size="lg">
              {t('free')}
            </Button>
            <Button href="/courses" variant="light" size="lg">
              {t('all')}
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}
