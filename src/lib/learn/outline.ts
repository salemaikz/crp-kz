// Прогресс по курсу и замки последовательного прохождения. Чистые функции, без БД.
import type { CourseProgress, LessonNode, ModuleProgress, OutlineModule } from './types';

/**
 * Собирает состояние оглавления из опубликованных уроков и множества пройденных.
 *
 * Последовательный курс (sequential): доступны пройденные уроки и первый непройденный,
 * остальные закрыты. Пройденный урок остаётся доступным, даже если порядок позже изменили.
 * Проценты: floor, а 100 — только когда пройдено всё (чтобы 249/250 не округлилось до 100).
 */
export function buildProgress(
  modules: readonly OutlineModule[],
  doneIds: ReadonlySet<string>,
  sequential: boolean,
): CourseProgress {
  const flat = modules.flatMap((m) => m.lessons);
  const firstIncomplete = flat.findIndex((l) => !doneIds.has(l.id));

  const nodes = new Map<string, LessonNode>();
  flat.forEach((l, index) => {
    const done = doneIds.has(l.id);
    const state = done ? 'done' : !sequential || index <= firstIncomplete ? 'open' : 'locked';
    nodes.set(l.id, { ...l, index, state });
  });

  const lessons = flat.map((l) => nodes.get(l.id) as LessonNode);
  const moduleList: ModuleProgress[] = modules.map((m) => {
    const ls = m.lessons.map((l) => nodes.get(l.id) as LessonNode);
    return {
      id: m.id,
      title: m.title,
      lessons: ls,
      done: ls.filter((l) => l.state === 'done').length,
      durationMin: ls.reduce((sum, l) => sum + l.durationMin, 0),
    };
  });

  const total = lessons.length;
  const done = lessons.filter((l) => l.state === 'done').length;
  const complete = total > 0 && done === total;
  const pct = complete ? 100 : total === 0 ? 0 : Math.min(99, Math.floor((done / total) * 100));
  return {
    modules: moduleList,
    lessons,
    total,
    done,
    pct,
    complete,
    next: firstIncomplete === -1 ? null : (lessons[firstIncomplete] ?? null),
  };
}

/** Соседние уроки в сквозном порядке. */
export function neighbours(progress: CourseProgress, lessonId: string): { prev: LessonNode | null; next: LessonNode | null } {
  const i = progress.lessons.findIndex((l) => l.id === lessonId);
  if (i === -1) return { prev: null, next: null };
  return { prev: progress.lessons[i - 1] ?? null, next: progress.lessons[i + 1] ?? null };
}
