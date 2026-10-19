import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CourseCard } from '@/components/learn/CourseCard';
import { Button, Card, Container, EmptyState, PageHeader, Section, TextLink } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { t as loc } from '@/lib/content/l10n';
import { formatDate } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { listCertificates, listLearnerCourses, type LearnerCourse } from '@/lib/learn/data';
import { coursePath } from '@/lib/learn/server';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  return { title: t('indexTitle'), robots: { index: false } };
}

/** Порядок: курсы в работе (ближайший срок выше, начатые выше), затем пройденные, затем с закрытым доступом. */
function rank(c: LearnerCourse): number {
  if (!c.access.ok) return 2;
  return c.progress.complete ? 1 : 0;
}
function byPriority(a: LearnerCourse, b: LearnerCourse): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  const da = a.enrollment.dueAt ?? Number.POSITIVE_INFINITY;
  const db = b.enrollment.dueAt ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  if (a.progress.done !== b.progress.done) return b.progress.done - a.progress.done;
  return a.enrollment.createdAt - b.enrollment.createdAt;
}

export default async function LearnPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);

  const user = await requireUser(locale, `/${locale}/learn`);
  const [t, courses, certificates] = await Promise.all([
    getTranslations('learn.index'),
    listLearnerCourses(user.id),
    listCertificates(user.id),
  ]);

  const sorted = [...courses].sort(byPriority);
  const open = sorted.filter((c) => c.access.ok);
  const closed = sorted.filter((c) => !c.access.ok);

  return (
    <>
      <PageHeader title={t('title')} lead={courses.length > 0 ? t('lead') : t('leadEmpty')} />

      <Section tone="board" spacing="tight">
        <Container>
          {courses.length === 0 ? (
            <Container size="narrow">
              <EmptyState
                title={t('empty.title')}
                description={t('empty.description')}
                action={
                  <Button href="/courses" size="lg" data-testid="empty-to-catalog">
                    {t('empty.action')}
                  </Button>
                }
              />
            </Container>
          ) : (
            <>
              {open.length > 0 && (
                <div className="lrn-block">
                  <div className="lrn-section-title">
                    <h2 className="h3">{t('coursesTitle')}</h2>
                  </div>
                  <div className="lrn-grid" data-testid="learn-courses">
                    {open.map((c) => (
                      <CourseCard key={c.course.id} item={c} locale={locale} />
                    ))}
                  </div>
                </div>
              )}

              {closed.length > 0 && (
                <div className="lrn-block">
                  <div className="lrn-section-title">
                    <h2 className="h3">{t('closedTitle')}</h2>
                    <p>{t('closedLead')}</p>
                  </div>
                  <div className="lrn-grid">
                    {closed.map((c) => (
                      <CourseCard key={c.course.id} item={c} locale={locale} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {(courses.length > 0 || certificates.length > 0) && (
            <div className="lrn-block" id="certificates">
              <div className="lrn-section-title">
                <h2 className="h3">{t('certificatesTitle')}</h2>
                <p>{t('certificatesLead')}</p>
              </div>
              {certificates.length === 0 ? (
                <Card tone="dashed" padding="md" large>
                  <p className="muted">{t('certificatesEmpty')}</p>
                </Card>
              ) : (
                <div className="lrn-certs" data-testid="learn-certificates">
                  {certificates.map((c) => (
                    <Card key={c.id} as="article" large padding="md" className="lrn-cert-item">
                      <div className="lrn-cert-item__body">
                        <h3 className="display lrn-cert-item__title">{loc(c.courseTitle, locale)}</h3>
                        <p className="meta">{t('certificateIssued', { date: formatDate(c.issuedAt, locale) })}</p>
                        <p className="meta num lrn-nowrap">{t('certificateNumber', { number: c.number })}</p>
                        <div className="lrn-cert-item__links">
                          <TextLink href={`${coursePath(c.courseSlug)}/certificate`}>{t('certificateOpen')}</TextLink>
                          <TextLink href={`/cert/${encodeURIComponent(c.number)}`}>{t('certificateVerify')}</TextLink>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </Container>
      </Section>
    </>
  );
}
