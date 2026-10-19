// Серверные хелперы страниц обучения (запрос Next): кеш на запрос, лимиты проверки сертификатов, безопасные параметры маршрута.
import { headers } from 'next/headers';
import { cache } from 'react';
import { deriveClientIp } from '../auth/clientIp';
import type { CourseRef } from './data';
import { loadCourseAccess } from './gate';
import { certCheckAllowed } from './limits';
import type { CourseAccess } from './types';

/** Доступ к курсу, кешируется на запрос: generateMetadata и страница не ходят в БД дважды. */
export const getCourseAccess = cache(
  (userId: string, slug: string): Promise<CourseAccess> => loadCourseAccess(userId, { slug } satisfies CourseRef),
);

/** Публичная проверка сертификата (страница): лимит по IP клиента, при неизвестном IP — по номеру. */
export async function certLookupAllowed(number: string): Promise<boolean> {
  return certCheckAllowed('cert-page', deriveClientIp(await headers()), number);
}

/** Форма «Проверить сертификат»: лимит по IP клиента, при неизвестном IP — по номеру. */
export async function certFormAllowed(number: string): Promise<boolean> {
  return certCheckAllowed('cert-lookup', deriveClientIp(await headers()), number);
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
