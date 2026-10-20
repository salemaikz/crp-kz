// Размер файла для показа: Intl.NumberFormat, для казахского — ISO-код kk (D-002).
// Единицы (Б, КБ, МБ, ГБ) подставляет вызывающий из files.units.*: здесь только число и индекс единицы.

export type SizeUnit = 'b' | 'kb' | 'mb' | 'gb';

export function splitFileSize(bytes: number): { value: number; unit: SizeUnit } {
  if (bytes < 1024) return { value: bytes, unit: 'b' };
  if (bytes < 1024 ** 2) return { value: bytes / 1024, unit: 'kb' };
  if (bytes < 1024 ** 3) return { value: bytes / 1024 ** 2, unit: 'mb' };
  return { value: bytes / 1024 ** 3, unit: 'gb' };
}

/** «2,4 МБ»: число по правилам локали, подписи единиц передаёт интерфейс. */
export function formatFileSize(bytes: number, locale: 'ru' | 'kz', units: Record<SizeUnit, string>): string {
  const { value, unit } = splitFileSize(bytes);
  const num = new Intl.NumberFormat(locale === 'kz' ? 'kk' : 'ru', {
    maximumFractionDigits: unit === 'b' || unit === 'kb' ? 0 : 1,
  }).format(value);
  return `${num} ${units[unit]}`;
}
