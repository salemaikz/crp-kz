// Причина ошибки рендера PDF для журнала: без ПДн. Журнал хостинга — внешний сервис (D-009).
// Всегда: имя класса и code (код — идентификатор, текста в нём нет). message — только у системных
// ошибок libuv (ENOENT, EACCES…) и у MODULE_NOT_FOUND: он описывает файл или модуль, а не входной
// текст. У остальных, включая ERR_* из Node, рендер может вставить в message ФИО или название курса
// (в любом регистре, с переносами), поэтому message не пишем.

const MAX = 200;
const LIBUV_CODE = /^E[A-Z]+$/;
const MESSAGE_SAFE = (code: string) => LIBUV_CODE.test(code) || code === 'MODULE_NOT_FOUND';

export function describeRenderError(e: unknown): string {
  if (!(e instanceof Error)) return 'error=non-Error';
  const code = (e as { code?: unknown }).code;
  const parts = [`error=${e.constructor?.name || e.name || 'Error'}`];
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) {
    parts.push(`code=${code}`);
    if (MESSAGE_SAFE(code)) {
      parts.push(`message=${(String(e.message ?? '').split(/\r?\n/, 1)[0] ?? '').slice(0, MAX)}`);
    }
  }
  return parts.join(', ');
}
