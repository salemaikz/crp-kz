// Результат server action для клиентских форм: успех или код ошибки с ошибками по полям.
// Файл без серверных зависимостей — типы используются и в клиентских компонентах.
import { AdminError, type ContentIssue, type FieldErrors } from './errors';

export type ActionFailure = {
  ok: false;
  /** Код AdminErrorCode или 'GENERIC' для неожиданных сбоев. */
  error: string;
  fields?: FieldErrors;
  issues?: ContentIssue[];
};

export type ActionResult<T extends object = Record<never, never>> = ({ ok: true } & T) | ActionFailure;

export function failure(e: unknown): ActionFailure {
  if (e instanceof AdminError) {
    return { ok: false, error: e.code, ...(e.fields ? { fields: e.fields } : {}), ...(e.issues ? { issues: e.issues } : {}) };
  }
  console.error('[admin] неожиданная ошибка действия', e);
  return { ok: false, error: 'GENERIC' };
}
