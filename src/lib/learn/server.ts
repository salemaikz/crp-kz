// Серверные хелперы страниц обучения (запрос Next): кеш на запрос, адрес клиента, безопасные параметры маршрута.
import { headers } from 'next/headers';
import { cache } from 'react';
import { rateLimit } from '../auth/rateLimit';
import type { CourseRef } from './data';
import { loadCourseAccess } from './gate';
import type { CourseAccess } from './types';

/** Доступ к курсу, кешируется на запрос: generateMetadata и страница не ходят в БД дважды. */
export const getCourseAccess = cache(
  (userId: string, slug: string): Promise<CourseAccess> => loadCourseAccess(userId, { slug } satisfies CourseRef),
);

export async function clientIp(): Promise<string> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'local';
  return ip.slice(0, 64);
}

/** Публичная проверка сертификатов: не больше 30 запросов в минуту с одного адреса. */
export async function certLookupAllowed(): Promise<boolean> {
  return rateLimit(`cert-page:${await clientIp()}`, 30, 60_000).ok;
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
