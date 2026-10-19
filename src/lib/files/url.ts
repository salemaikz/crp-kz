// Адреса файлов (D-034): чистые функции для сервера и браузера. Импортов здесь быть не должно:
// файл попадает в клиентский бандл (проверяет tests/unit/core-static-guards.test.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ссылка на файл в контенте урока и в courses.cover. */
export function fileUrl(id: string): string {
  return `/api/files/${id}`;
}

/**
 * Ссылки на файлы в тексте (относительные и абсолютные, с «?x=1»). Регулярное выражение
 * глобальное: применять через matchAll или replace, а не test (lastIndex).
 */
export const FILE_URL_RE =
  /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/gi;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Обложка для витрины и обучения: при неактивной загрузке файлов адрес /api/files/… вернул бы
 * 404 и сломал картинку, поэтому заменяется на null. Флаг передаёт вызывающий сервер
 * (isFeatureActive('UPLOADS')) — читать его здесь нельзя, см. комментарий вверху.
 */
export function visibleCover(cover: string | null, uploadsActive: boolean): string | null {
  if (cover === null) return null;
  return cover.startsWith('/api/files/') && !uploadsActive ? null : cover;
}
