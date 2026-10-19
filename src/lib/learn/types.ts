// Типы слоя «обучение». Контент и доступ — в src/lib/content и src/lib/access.
import type { Enrollment } from '../access';
import type { L10n, Locale } from '../content/types';

export type CourseInfo = {
  id: string;
  slug: string;
  title: L10n;
  summary: L10n;
  cover: string | null;
  level: 'start' | 'base' | 'pro' | null;
  durationMin: number;
  sequential: boolean;
  status: 'draft' | 'published';
  visibility: 'public' | 'internal' | 'private';
};

/** Опубликованный урок в оглавлении (контент не грузим). */
export type OutlineLesson = {
  id: string;
  slug: string;
  title: L10n;
  durationMin: number;
  moduleId: string;
};

export type OutlineModule = { id: string; title: L10n; lessons: OutlineLesson[] };

/** done — пройден; open — доступен; locked — закрыт порядком прохождения. */
export type LessonState = 'done' | 'open' | 'locked';

export type LessonNode = OutlineLesson & {
  /** Сквозной номер урока в курсе, с нуля. */
  index: number;
  state: LessonState;
};

export type ModuleProgress = {
  id: string;
  title: L10n;
  lessons: LessonNode[];
  done: number;
  durationMin: number;
};

/** Прогресс слушателя по курсу: считаются только опубликованные уроки. */
export type CourseProgress = {
  modules: ModuleProgress[];
  lessons: LessonNode[];
  total: number;
  done: number;
  /** 0–100; 100 только когда пройдены все уроки. */
  pct: number;
  complete: boolean;
  /** Первый непройденный урок (куда вести «Продолжить»). */
  next: LessonNode | null;
};

export type CourseAccess =
  | { status: 'not_found' }
  | { status: 'denied'; course: CourseInfo; reason: 'none' | 'expired' | 'revoked'; enrollment: Enrollment | null }
  | { status: 'ok'; course: CourseInfo; enrollment: Enrollment; progress: CourseProgress };

// ---------- Тесты ----------

export type QuizQuestionResult = { correct: boolean; explain?: string };

/**
 * Результат попытки (D-020). Провал — только «не сдан»: ни счёта, ни разбора по вопросам
 * (иначе ответы подбираются перебором — меняя по одному и глядя на счёт). Сдан — счёт, разбор
 * по вопросам и пояснения.
 */
export type QuizResult =
  | { passed: false }
  | {
      passed: true;
      correct: number;
      total: number;
      scorePct: number;
      passScore: number;
      perQuestion: QuizQuestionResult[];
    };

/** bestPct — лучший результат среди сданных попыток (null, пока не сдан): счёт провалов клиенту не уходит. */
export type QuizStatus = { attempts: number; passed: boolean; bestPct: number | null };

// ---------- Сертификаты ----------

export type CertificateRow = {
  id: string;
  number: string;
  userId: string;
  courseId: string;
  holderName: string;
  locale: Locale;
  issuedAt: number;
};

export type CertificateListItem = CertificateRow & { courseSlug: string; courseTitle: L10n };

/** Публичная запись для проверки: без email и id пользователя. */
export type PublicCertificate = {
  number: string;
  holderName: string;
  courseTitle: L10n;
  locale: Locale;
  issuedAt: number;
};

// ---------- Результаты server actions ----------

export type ActionError =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'locked'
  | 'invalid'
  | 'quiz_required'
  | 'not_complete'
  | 'bad_content'
  | 'rate_limited'
  | 'server';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export type CompleteData = {
  done: number;
  total: number;
  pct: number;
  courseComplete: boolean;
  alreadyCompleted: boolean;
  next: { slug: string; title: string } | null;
};
