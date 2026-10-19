// Типы раздела «Команда»: организации руководителя, сотрудники, назначения, отчёт. Нормативно: SPEC §6.
import type { L10nRaw } from '../catalog/types';

export type ManagedOrg = { orgId: string; slug: string; name: string; kind: 'owner' | 'client' };

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  position: string | null;
  role: 'manager' | 'member';
};

/** Курс, который руководитель может назначить своим сотрудникам. */
export type AssignableCourse = {
  id: string;
  slug: string;
  title: L10nRaw;
  visibility: 'public' | 'internal';
  priceKzt: number | null;
  accessDays: number | null;
};

/**
 * Статус строки отчёта:
 * done — все опубликованные уроки пройдены; revoked/expired — доступа уже нет;
 * overdue/today/soon/ok — по сроку сдачи; nodue — срока нет (курс начат сотрудником сам).
 */
export type TeamRowStatus = 'done' | 'overdue' | 'today' | 'soon' | 'ok' | 'nodue' | 'revoked' | 'expired';

/** Группы статусов для фильтра отчёта. */
export type TeamStatusFilter = 'overdue' | 'soon' | 'active' | 'done' | 'inactive';

export type TeamReportRow = {
  /** id зачисления — ключ строки. */
  key: string;
  userId: string;
  name: string;
  email: string;
  position: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: L10nRaw;
  source: string;
  lessonsDone: number;
  lessonsTotal: number;
  /** 0..100 */
  progress: number;
  /** Средний лучший результат по тестам курса, % (null — тесты ещё не сдавались). */
  quizScore: number | null;
  quizzesAttempted: number;
  quizzesPassed: number;
  dueAt: number | null;
  status: TeamRowStatus;
  certificate: { number: string; issuedAt: number } | null;
};

export type TeamSummary = {
  employees: number;
  /** Назначения в работе: не завершены и доступ действует. */
  active: number;
  overdue: number;
  done: number;
  /** Назначения, которые считаются в проценте завершения (без закрытого доступа). */
  counted: number;
  /** Доля завершённых, 0..100; null — назначений нет. */
  completionPercent: number | null;
};

export type TeamErrorCode =
  | 'forbidden'
  | 'invalid_input'
  | 'no_employees'
  | 'too_many'
  | 'not_member'
  | 'course_not_assignable'
  | 'due_past';

/** Ожидаемая ошибка операции руководителя: код показывается пользователю через сообщения. */
export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code);
    this.name = 'TeamError';
  }
}
