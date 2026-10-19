// Типы каталога курсов. Нормативно: docs/lms/BUILD.md §3, §6.
import type { AccessResult } from '../access';

export type CourseLevel = 'start' | 'base' | 'pro';
export type CourseVisibility = 'public' | 'internal' | 'private';

/** Локализованное поле из jsonb: { ru, kz? }. Читается через t() из lib/content/l10n. */
export type L10nRaw = Record<string, unknown> | null;

/** Курс для карточки каталога и страницы курса (без содержимого уроков). */
export type CatalogCourse = {
  id: string;
  slug: string;
  title: L10nRaw;
  summary: L10nRaw;
  /** URL обложки-фото или null — тогда рисуется тёмная панель тона с числом уроков. */
  cover: string | null;
  level: CourseLevel | null;
  durationMin: number;
  visibility: CourseVisibility;
  status: 'draft' | 'published';
  ownerOrgId: string | null;
  /** Организация-владелец (для подписи «Для сотрудников ЦРП»). */
  ownerOrgName: string | null;
  ownerOrgKind: 'owner' | 'client' | null;
  position: number;
  /** Цена из предложения (offer); null — предложения нет. */
  priceKzt: number | null;
  accessDays: number | null;
  /** Продажи включены. Для курса без предложения — false. */
  offerActive: boolean;
  /** Только опубликованные уроки; модули без таких уроков не считаются. */
  modulesCount: number;
  lessonsCount: number;
};

export type CourseDetail = CatalogCourse & {
  description: L10nRaw;
  sequential: boolean;
};

export type ProgramLesson = { id: string; title: L10nRaw; durationMin: number };
export type ProgramModule = { id: string; title: L10nRaw; lessons: ProgramLesson[]; durationMin: number };

/** Состояние курса для конкретного зрителя (вошедшего). */
export type ViewerCourseState = {
  access: AccessResult;
  /** Источник и срок зачисления — нужны, чтобы показать «срок сдачи» назначенного курса. */
  dueAt: number | null;
  source: string | null;
  expiresAt: number | null;
  lessonsDone: number;
  lessonsTotal: number;
  /** 0..100 */
  percent: number;
};

export type CatalogFilter = 'all' | 'paid' | 'free' | 'staff';
