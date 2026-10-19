// Правила видимости курсов в каталоге (чистые функции, без БД). Нормативно: SPEC §1–2, BUILD §6.
import type { CatalogCourse, CatalogFilter, CourseVisibility } from './types';

export const CATALOG_FILTERS: readonly CatalogFilter[] = ['all', 'paid', 'free', 'staff'];

type VisibilityInput = {
  status: string;
  visibility: CourseVisibility | string;
  ownerOrgId: string | null;
};

/**
 * Виден ли курс зрителю:
 * - черновик не виден никому;
 * - public — всем;
 * - internal — только членам организации-владельца;
 * - private — в каталоге и на странице курса никому (только по прямому назначению).
 * Видимость курса ≠ доступ к урокам: доступ даёт только зачисление (lib/access).
 */
export function isCourseVisible(course: VisibilityInput, memberOrgIds: readonly string[]): boolean {
  if (course.status !== 'published') return false;
  if (course.visibility === 'public') return true;
  if (course.visibility === 'internal') return course.ownerOrgId !== null && memberOrgIds.includes(course.ownerOrgId);
  return false;
}

/** Курс бесплатный: предложения нет или цена 0 (как в canSelfEnroll). */
export function isFreeCourse(course: Pick<CatalogCourse, 'priceKzt'>): boolean {
  return !course.priceKzt;
}

/** Фильтр каталога: платные и бесплатные — только публичные; «для сотрудников» — внутренние. */
export function matchesFilter(course: CatalogCourse, filter: CatalogFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'paid':
      return course.visibility === 'public' && !isFreeCourse(course);
    case 'free':
      return course.visibility === 'public' && isFreeCourse(course);
    case 'staff':
      return course.visibility === 'internal';
  }
}

/** Значение ?f= → фильтр (неизвестное — «все»). */
export function parseFilter(value: unknown): CatalogFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (CATALOG_FILTERS as readonly unknown[]).includes(v) ? (v as CatalogFilter) : 'all';
}

/** Подпись срока доступа: 365 дней → { unit: 'month', value: 12 }; null → бессрочно. */
export function accessPeriod(days: number | null): { unit: 'month' | 'day'; value: number } | null {
  if (days === null || days <= 0) return null;
  if (days >= 60) {
    const months = Math.round(days / 30.4375);
    if (Math.abs(days - months * 30.4375) <= 3) return { unit: 'month', value: months };
  }
  return { unit: 'day', value: days };
}
