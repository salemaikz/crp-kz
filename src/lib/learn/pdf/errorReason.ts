// Причина ошибки рендера PDF для журнала: без ПДн. Имя класса, code и первая строка message (до 200 символов).
// Рендер может вставить в message фрагменты входного текста, поэтому ФИО и название курса из message вырезаются.
import type { CertificatePdfInput } from './types';

const MAX = 200;

export function describeRenderError(e: unknown, input: Pick<CertificatePdfInput, 'holderName' | 'courseTitle'>): string {
  if (!(e instanceof Error)) return 'error=non-Error';
  const code = (e as { code?: unknown }).code;
  const parts = [`error=${e.constructor?.name || e.name || 'Error'}`];
  if (typeof code === 'string' || typeof code === 'number') parts.push(`code=${String(code).slice(0, 40)}`);
  let msg = String(e.message ?? '').split(/\r?\n/, 1)[0] ?? '';
  // длинные фрагменты первыми, чтобы короткое слово не оставило хвост названия
  const secrets = [input.holderName, input.courseTitle]
    .flatMap((v) => [v, ...v.split(/\s+/)])
    .filter((v) => v.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const v of secrets) {
    msg = msg.split(v).join('[…]').split(v.toLowerCase()).join('[…]');
  }
  parts.push(`message=${msg.slice(0, MAX)}`);
  return parts.join(', ');
}
