// Причина ошибки рендера PDF для журнала: без ПДн. Журнал хостинга — внешний сервис (D-009).
// Всегда: имя класса и code. message — только у системных ошибок Node (ENOENT и т.п.): он описывает
// файл или системный вызов, а не входной текст. У остальных ошибок рендер может вставить в message
// ФИО или название курса (в любой раскладке регистра, с переносами), поэтому message не пишем.

const MAX = 200;
const SYSTEM_CODE = /^E[A-Z0-9_]+$/;

export function describeRenderError(e: unknown): string {
  if (!(e instanceof Error)) return 'error=non-Error';
  const code = (e as { code?: unknown }).code;
  const parts = [`error=${e.constructor?.name || e.name || 'Error'}`];
  if (typeof code === 'string' && SYSTEM_CODE.test(code)) {
    parts.push(`code=${code.slice(0, 40)}`);
    parts.push(`message=${(String(e.message ?? '').split(/\r?\n/, 1)[0] ?? '').slice(0, MAX)}`);
  }
  return parts.join(', ');
}
