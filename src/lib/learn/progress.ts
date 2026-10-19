// Завершение урока. Урок с тестами засчитывается только при сданных тестах показываемого документа.
import type { Locale } from '../content/types';
import { getDb, now } from '../db';
import { t } from '../content/l10n';
import { attemptKey, quizBlocksOf } from './content';
import { getDoneLessonIds, getOutlineModules } from './data';
import { LearnError } from './errors';
import { loadLessonForAction } from './gate';
import { buildProgress } from './outline';
import { getQuizStatuses } from './quiz';
import type { CompleteData } from './types';

export type CompleteInput = { userId: string; lessonId: string; locale: Locale };

/**
 * Отметить урок пройденным (идемпотентно).
 * Требования: опубликованный курс и урок, действующее зачисление, урок не закрыт порядком,
 * для каждого теста документа текущей локали (или запасного ru, который реально показан) есть сданная попытка.
 */
export async function completeLesson(input: CompleteInput): Promise<CompleteData> {
  const { access, picked, lesson } = await loadLessonForAction(input.userId, input.lessonId, input.locale);

  const quizzes = quizBlocksOf(picked.doc);
  if (quizzes.length > 0) {
    const statuses = await getQuizStatuses(input.userId, input.lessonId);
    const missing = quizzes.filter((b) => !statuses.get(attemptKey(picked.locale, b.id))?.passed).map((b) => b.id);
    if (missing.length > 0) throw new LearnError('quiz_required', { missing });
  }

  const db = await getDb();
  const inserted = await db.sql<{ lessonId: string }>`
    INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at)
    VALUES (${input.userId}, ${lesson.id}, ${access.course.id}, ${now()})
    ON CONFLICT (user_id, lesson_id) DO NOTHING
    RETURNING lesson_id`;

  // состояние после отметки: новый прогресс и следующий доступный урок
  const [modules, done] = await Promise.all([
    getOutlineModules(access.course.id),
    getDoneLessonIds(input.userId, access.course.id),
  ]);
  const progress = buildProgress(modules, done, access.course.sequential);
  const after = progress.lessons[progress.lessons.findIndex((l) => l.id === lesson.id) + 1];
  const next = after && after.state !== 'locked' ? { slug: after.slug, title: t(after.title, input.locale) } : null;

  return {
    done: progress.done,
    total: progress.total,
    pct: progress.pct,
    courseComplete: progress.complete,
    alreadyCompleted: inserted.length === 0,
    next,
  };
}
