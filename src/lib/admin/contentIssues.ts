// Проблемы контента урока в плоском виде: путь, код zod, сообщение, границы.
// Без серверных зависимостей: тот же код превращает ошибки zod и на сервере (ответ действия),
// и в браузере (живая проверка в редакторе).
import type { ZodError } from 'zod';
import type { ContentIssue } from './errors';

export const MAX_ISSUES = 60;

export function toContentIssues(error: ZodError, max: number = MAX_ISSUES): ContentIssue[] {
  return error.issues.slice(0, max).map((i): ContentIssue => {
    const out: ContentIssue = { path: i.path, code: i.code, message: i.message };
    if (i.code === 'too_small') {
      out.type = i.type;
      out.minimum = Number(i.minimum);
    } else if (i.code === 'too_big') {
      out.type = i.type;
      out.maximum = Number(i.maximum);
    }
    return out;
  });
}
