import { useTranslations } from 'next-intl';
import { Badge, Button, Card, Container, EmptyState, Section, TextLink } from '@/components/ui';
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
          <h2 id="featured-title" className="display h2">
            {t('title')}
          </h2>
          <TextLink href="/courses">{t('all')}</TextLink>
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

/** «Как проходит обучение»: светлая секция, над шагом тонкая линия, номер 01–04 контурной красной цифрой, как на сайте v3. */
export function HowItWorks() {
  const t = useTranslations('catalog.home.steps');
  return (
    <Section tone="paper" aria-labelledby="steps-title">
      <Container>
        <div className="section-head">
          <h2 id="steps-title" className="display h2">
            {t('title')}
          </h2>
        </div>
        <ol className="cat-steps">
          {STEPS.map((key, i) => (
            <li key={key} className="cat-step">
              <span className="cat-step__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="cat-step__title">{t(`${key}.title`)}</h3>
              <p className="cat-step__text">{t(`${key}.text`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}

export type TeamsViewer = 'guest' | 'user' | 'manager';

/** «Обучение команд»: обучение сотрудников ЦРП (ссылка на «Команду» для руководителей) и B2B «скоро». */
export function TeamsBlock({ viewer, locale }: { viewer: TeamsViewer; locale: Locale }) {
  const t = useTranslations('catalog.home.teams');
  return (
    <Section tone="board" aria-labelledby="teams-title">
      <Container>
        <div className="section-head">
          <h2 id="teams-title" className="display h2">
            {t('title')}
          </h2>
        </div>
        <div className="cat-teams">
          <Card large padding="lg" className="cat-team">
            <h3 className="h3">{t('staff.title')}</h3>
            <p className="muted">{t('staff.text')}</p>
            <ul className="cat-rows">
              {(['point1', 'point2', 'point3'] as const).map((k) => (
                <li key={k}>{t(`staff.${k}`)}</li>
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
            <ul className="cat-rows">
              {(['point1', 'point2', 'point3'] as const).map((k) => (
                <li key={k}>{t(`clients.${k}`)}</li>
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

/**
 * Финальная карточка, как заявка на сайте: тёмная, с красным свечением внизу слева.
 * Единственное место после первого экрана, где допустим этот декор.
 */
export function FinalCta() {
  const t = useTranslations('catalog.home.final');
  return (
    <Section tone="board" spacing="tight" className="cat-final-section" aria-labelledby="final-title">
      <Container>
        <div className="cat-final on-night">
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
