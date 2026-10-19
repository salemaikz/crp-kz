import { getTranslations } from 'next-intl/server';
import { Button, Container, EmptyState, Section } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDate } from '@/lib/format';
import { coursePath, lessonPath } from '@/lib/learn/server';
import type { CourseInfo } from '@/lib/learn/types';
import './learn.css';

type NoAccessProps = {
  course: CourseInfo;
  reason: 'none' | 'expired' | 'revoked';
  expiresAt: number | null;
  locale: Locale;
};

/** Дружелюбная страница «нет доступа»: что случилось и куда идти (на страницу курса). */
export async function NoAccess({ course, reason, expiresAt, locale }: NoAccessProps) {
  const t = await getTranslations('learn.noAccess');
  const date = expiresAt ? formatDate(expiresAt, locale) : '';
  return (
    <Section tone="board" spacing="tight">
      <Container size="narrow">
        <EmptyState
          title={t(`${reason}.title`)}
          description={t(`${reason}.description`, { course: loc(course.title, locale), date })}
          action={
            <>
              <Button href={`/courses/${encodeURIComponent(course.slug)}`} data-testid="no-access-course-link">
                {reason === 'expired' ? t('renew') : t('toCourse')}
              </Button>
              <Button href="/learn" variant="ghost">
                {t('toLearn')}
              </Button>
            </>
          }
        />
      </Container>
    </Section>
  );
}

type LockedProps = {
  courseSlug: string;
  locale: Locale;
  /** Урок, который нужно пройти первым. */
  nextTitle: string | null;
  nextSlug: string | null;
};

/** Урок закрыт порядком прохождения: ведём к тому, что нужно пройти сначала. */
export async function LockedLesson({ courseSlug, nextTitle, nextSlug }: LockedProps) {
  const t = await getTranslations('learn.locked');
  return (
    <Section tone="board" spacing="tight">
      <Container size="narrow">
        <EmptyState
          title={t('title')}
          description={nextTitle ? t('description', { title: nextTitle }) : t('descriptionPlain')}
          action={
            <>
              {nextSlug && (
                <Button href={lessonPath(courseSlug, nextSlug)}>{t('goNext')}</Button>
              )}
              <Button href={coursePath(courseSlug)} variant="ghost">
                {t('toCourse')}
              </Button>
            </>
          }
        />
      </Container>
    </Section>
  );
}

/** Контент урока не прошёл проверку схемы: просим вернуться позже, а не показываем ошибку сборки. */
export async function BrokenLesson({ courseSlug }: { courseSlug: string }) {
  const t = await getTranslations('learn.broken');
  return (
    <Section tone="board" spacing="tight">
      <Container size="narrow">
        <EmptyState
          title={t('title')}
          description={t('description')}
          action={<Button href={coursePath(courseSlug)}>{t('toCourse')}</Button>}
        />
      </Container>
    </Section>
  );
}
