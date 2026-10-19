'use client';

import { useEffect, useState } from 'react';

/**
 * Параметры из фрагмента адреса (#token=…&next=…). Токен ссылки лежит во фрагменте: он не уходит на
 * сервер, не попадает в логи и Referer. Прочитанное сразу убирается из адреса (history.replaceState),
 * чтобы не остаться в истории и не уйти по случайной ссылке дальше.
 * До чтения (на сервере и при первой отрисовке) возвращает null.
 */
export function useHashParams(): URLSearchParams | null {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    // фрагмент доступен только в браузере, поэтому чтение — в эффекте
    if (raw) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParams(new URLSearchParams(raw));
    } else {
      // StrictMode в dev запускает эффект дважды: второй раз адрес уже очищен, прочитанное не затираем
      setParams((prev) => prev ?? new URLSearchParams());
    }
  }, []);
  return params;
}
