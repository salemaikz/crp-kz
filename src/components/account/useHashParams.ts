'use client';

import { useEffect, useState } from 'react';
import { parseHashParams } from './hashParams';

/**
 * Параметры из фрагмента адреса (#token=…&next=…). Токен ссылки лежит во фрагменте: он не уходит на
 * сервер, не попадает в логи и Referer. Прочитанное сразу убирается из адреса (history.replaceState),
 * чтобы не остаться в истории и не уйти по случайной ссылке дальше.
 * До чтения (на сервере и при первой отрисовке) возвращает null.
 */
export function useHashParams(): URLSearchParams | null {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    // фрагмент доступен только в браузере, поэтому чтение — в эффекте
    const raw = window.location.hash;
    if (raw.replace(/^#/, '')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    // разбор — чистая функция: пустой hash при повторном запуске эффекта (StrictMode) не затирает токен
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParams((prev) => parseHashParams(raw, prev));
  }, []);
  return params;
}
