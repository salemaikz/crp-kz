/**
 * Разбор фрагмента адреса в параметры. Чистая функция (без window), чтобы проверять её без DOM.
 * raw — hash как есть (с «#» или без), prev — уже прочитанное. Пустой фрагмент не затирает прочитанное:
 * StrictMode в dev запускает эффект дважды, и во второй раз адрес уже очищен.
 */
export function parseHashParams(raw: string, prev: URLSearchParams | null): URLSearchParams {
  const body = raw.replace(/^#/, '');
  if (body) return new URLSearchParams(body);
  return prev ?? new URLSearchParams();
}
