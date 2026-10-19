// Даты редакций документов: 'YYYY-MM-DD' (версия может иметь суффикс '-N') → миллисекунды для formatDate.

/** Полдень UTC этого дня: в Астане (UTC+5) та же календарная дата. */
export function versionDateMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`legal: некорректная дата редакции «${date}»`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}
