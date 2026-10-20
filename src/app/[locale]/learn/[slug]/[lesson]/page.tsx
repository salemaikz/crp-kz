import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Blocks } from '@/components/learn/Blocks';
import { CompletionCard } from '@/components/learn/CompletionCard';
import { LessonActions } from '@/components/learn/LessonActions';
import { LessonRuntime } from '@/components/learn/LessonRuntime';
import { BrokenLesson, LockedLesson, NoAccess } from '@/components/learn/Notices';
import { OutlineNav } from '@/components/learn/OutlineNav';
import { Alert, Badge, Breadcrumbs, Card, Container, Section } from '@/components/ui';
import { getCurrentUser, requireUser } from '@/lib/auth';
import { t as loc } from '@/lib/content/l10n';
import { getDb } from '@/lib/db';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { formatDuration } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { getCertificate } from '@/lib/learn/certificates';
import { attemptKey, pickLessonDoc, quizBlocksOf, toPublicLesson } from '@/lib/learn/content';
import { getLessonContent } from '@/lib/learn/data';
import { neighbours } from '@/lib/learn/outline';
import { getQuizStatuses } from '@/lib/learn/quiz';
import { coursePath, getCourseAccess, lessonPath, routeParam } from '@/lib/learn/server';
import type { QuizStatus } from '@/lib/learn/types';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string; slug: string; lesson: string }> };

/** Документы урока (PDF, DOCX, XLSX) из lesson_files: ссылки на них в тексте не выдаются слушателю в демо. */
async function lessonDocumentIds(lessonId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.sql<{ fileId: string }>`
    SELECT lf.file_id FROM lesson_files lf JOIN files f ON f.id = lf.file_id
    WHERE lf.lesson_id = ${lessonId} AND f.kind = 'document' AND f.status = 'active'`;
  return rows.map((r) => r.fileId);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug, lesson } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  const user = await getCurrentUser();
  const access = user ? await getCourseAccess(user.id, routeParam(slug)) : null;
  const node = access?.status === 'ok' ? access.progress.lessons.find((l) => l.slug === routeParam(lesson)) : undefined;
  return {
    title: node && access?.status === 'ok' ? `${loc(node.title, locale)} — ${loc(access.course.title, locale)}` : t('lessonTitle'),
    robots: { index: false },
  };
}

export default async function LessonPage({ params }: Props) {
  const { locale: raw, slug: rawSlug, lesson: rawLesson } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const slug = routeParam(rawSlug);
  const lessonSlug = routeParam(rawLesson);

  const user = await requireUser(locale, `/${locale}/learn/${rawSlug}/${rawLesson}`);
  const access = await getCourseAccess(user.id, slug);
  if (access.status === 'not_found') notFound();
  if (access.status === 'denied') {
    return <NoAccess course={access.course} reason={access.reason} expiresAt={access.enrollment?.expiresAt ?? null} locale={locale} />;
  }

  const { course, progress } = access;
  const node = progress.lessons.find((l) => l.slug === lessonSlug);
  if (!node) notFound();
  if (node.state === 'locked') {
    return (
      <LockedLesson
        courseSlug={course.slug}
        locale={locale}
        nextTitle={progress.next ? loc(progress.next.title, locale) : null}
        nextSlug={progress.next?.slug ?? null}
      />
    );
  }

  const picked = pickLessonDoc(await getLessonContent(node.id), locale);
  if (!picked) return <BrokenLesson courseSlug={course.slug} />;

  const [t, a11y, nav] = await Promise.all([
    getTranslations('learn'),
    getTranslations('common.a11y'),
    getTranslations('common.nav'),
  ]);

  const quizzes = quizBlocksOf(picked.doc);
  const statuses = quizzes.length > 0 ? await getQuizStatuses(user.id, node.id) : new Map<string, QuizStatus>();
  const quizStatus: Record<string, QuizStatus | null> = {};
  for (const b of quizzes) quizStatus[b.id] = statuses.get(attemptKey(picked.locale, b.id)) ?? null;
  const initialPassed = quizzes.filter((b) => quizStatus[b.id]?.passed).map((b) => b.id);

  // файлы урока: флаг и правило демо (D-038) считает сервер, клиентские компоненты env не читают
  const filesEnabled = isFeatureActive('UPLOADS');
  const hideDocuments = filesEnabled && isDemo() && user.role !== 'admin';
  const documentIds = hideDocuments ? await lessonDocumentIds(node.id) : [];

  const { prev, next } = neighbours(progress, node.id);
  const isLast = next === null;
  const certificate = isLast ? await getCertificate(user.id, course.id) : null;
  const moduleIndex = progress.modules.findIndex((m) => m.lessons.some((l) => l.id === node.id));
  const lessonModule = progress.modules[moduleIndex];

  const courseTitle = loc(course.title, locale);
  const lessonTitle = loc(node.title, locale);
  const completed = node.state === 'done';
  const nextOpenNow = next !== null && next.state !== 'locked';
  const certificateHref = `${coursePath(course.slug)}/certificate`;

  // «Модуль · урок 3 из 16 · 12 мин» одной строкой под заголовком
  const moduleTitle = lessonModule ? loc(lessonModule.title, locale) : '';
  const position = [
    moduleTitle || null,
    // без названия модуля строка начинается с позиции — с заглавной
    t(moduleTitle ? 'lesson.position' : 'lesson.positionFirst', { n: node.index + 1, total: progress.total }),
    node.durationMin > 0 ? formatDuration(node.durationMin, locale) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const outline = (
    <OutlineNav locale={locale} courseSlug={course.slug} courseTitle={courseTitle} progress={progress} currentLessonId={node.id} />
  );

  return (
    <Section tone="board" spacing="none">
      <Container className="lrn-top">
        <Breadcrumbs
          label={a11y('breadcrumbs')}
          items={[
            { label: nav('learn'), href: '/learn' },
            { label: courseTitle, href: coursePath(course.slug) },
            { label: lessonTitle },
          ]}
        />
      </Container>

      <Container className="lrn-shell">
        <aside className="lrn-aside" aria-label={t('outline.title')}>
          {outline}
        </aside>

        <div className="lrn-mobile-outline">
          <details>
            <summary>
              <span>
                {t('outline.title')} <span className="meta">· {t('outline.progress', { done: progress.done, total: progress.total })}</span>
              </span>
              <ChevronDown aria-hidden="true" />
            </summary>
            {outline}
          </details>
        </div>

        <div className="lrn-main">
          <header className="lrn-head">
            <h1 className="display lrn-head__title" data-testid="lesson-title">
              {lessonTitle}
            </h1>
            <div className="lrn-head__meta">
              <p className="meta">{position}</p>
              {quizzes.length > 0 && <Badge tone="neutral">{t('outline.quiz')}</Badge>}
              {completed && (
                <Badge tone="success" dot data-testid="lesson-done-badge">
                  {t('state.done')}
                </Badge>
              )}
            </div>
          </header>

          {picked.fallback && (
            <Alert tone="info" data-testid="fallback-notice">
              {t('lesson.fallback')}
            </Alert>
          )}

          <LessonRuntime
            key={node.id}
            lessonId={node.id}
            locale={locale}
            requiredQuizIds={quizzes.map((b) => b.id)}
            initialPassed={initialPassed}
            initialCompleted={completed}
          >
            <Card as="article" large padding="none" className="lrn-article">
              {picked.doc.blocks.length === 0 ? (
                <p className="muted">{t('lesson.empty')}</p>
              ) : (
                <Blocks
                  blocks={toPublicLesson(picked).blocks}
                  lessonId={node.id}
                  lessonTitle={lessonTitle}
                  locale={locale}
                  quizStatus={quizStatus}
                  filesEnabled={filesEnabled}
                  hideDocuments={hideDocuments}
                  documentIds={documentIds}
                />
              )}
            </Card>

            <LessonActions
              courseHref={coursePath(course.slug)}
              prev={prev ? { href: lessonPath(course.slug, prev.slug), title: loc(prev.title, locale) } : null}
              next={next ? { href: lessonPath(course.slug, next.slug), title: loc(next.title, locale) } : null}
              nextOpenNow={nextOpenNow}
              courseComplete={progress.complete}
              isLast={isLast}
              completionSlot={
                <CompletionCard
                  courseId={course.id}
                  courseTitle={courseTitle}
                  lessonsCount={progress.total}
                  locale={locale}
                  certificateNumber={certificate?.number ?? null}
                  courseHref={coursePath(course.slug)}
                  certificateHref={certificateHref}
                />
              }
            />
          </LessonRuntime>
        </div>
      </Container>
    </Section>
  );
}
