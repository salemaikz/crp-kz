// Серверные хелперы страниц обучения (запрос Next): кеш на запрос, лимиты по IP клиента, безопасные параметры маршрута.
import { headers } from 'next/headers';
import { cache } from 'react';
import { deriveClientIp, UNKNOWN_IP } from '../auth/clientIp';
import { rateLimit } from '../auth/rateLimit';
import type { CourseRef } from './data';
import { loadCourseAccess } from './gate';
import type { CourseAccess } from './types';

/** Доступ к курсу, кешируется на запрос: generateMetadata и страница не ходят в БД дважды. */
export const getCourseAccess = cache(
  (userId: string, slug: string): Promise<CourseAccess> => loadCourseAccess(userId, { slug } satisfies CourseRef),
);

/** Лимиты публичной проверки сертификатов: страница и форма поиска номера. */
const CERT_LIMITS = {
  /** На IP клиента (доверенная схема, D-018). */
  perIp: { limit: 30, windowMs: 60_000 },
  /** IP неизвестен (нет доверенного прокси) — одно общее ведро на всех, порог выше. */
  unknownIp: { limit: 600, windowMs: 60_000 },
} as const;

/**
 * Лимит частоты по IP клиента. IP — только по доверенной схеме (deriveClientIp, D-018):
 * X-Forwarded-For от клиента не читается. Неизвестный IP — общее ведро с порогом unknownIp.
 */
async function allowByIp(
  scope: string,
  limits: { perIp: { limit: number; windowMs: number }; unknownIp: { limit: number; windowMs: number } },
): Promise<boolean> {
  const ip = deriveClientIp(await headers());
  const l = ip === UNKNOWN_IP ? limits.unknownIp : limits.perIp;
  return rateLimit(`${scope}:${ip}`, l.limit, l.windowMs).ok;
}

/** Публичная проверка сертификатов (страница): не больше 30 запросов в минуту с одного адреса. */
export async function certLookupAllowed(): Promise<boolean> {
  return allowByIp('cert-page', CERT_LIMITS);
}

/** Форма «Проверить сертификат»: не больше 30 проверок в минуту с одного адреса. */
export async function certFormAllowed(): Promise<boolean> {
  return allowByIp('cert-lookup', CERT_LIMITS);
}

/** Параметр маршрута: раскодируем процентные последовательности (кириллица, пробелы) один раз. */
export function routeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Путь урока без локали: /learn/<курс>/<урок>. */
export function lessonPath(courseSlug: string, lessonSlug: string): string {
  return `/learn/${encodeURIComponent(courseSlug)}/${encodeURIComponent(lessonSlug)}`;
}

export function coursePath(courseSlug: string): string {
  return `/learn/${encodeURIComponent(courseSlug)}`;
}
