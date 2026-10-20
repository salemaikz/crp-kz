'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** Путь без языкового сегмента: «/ru/courses/x/buy» → «/courses/x/buy». */
export function pathWithoutLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
}

/**
 * Страницы, где плашка подтверждения email из layout не нужна: покупка рисует свой вариант
 * checkout (иначе на странице две кнопки «отправить письмо»), а на /account/verify человек
 * как раз подтверждает email. Layout не перерисовывается при переходах внутри сайта, поэтому
 * решение принимается на клиенте по текущему пути, а не на сервере.
 */
export function isNoticeHiddenPath(pathname: string): boolean {
  const path = pathWithoutLocale(pathname);
  return /^\/courses\/[^/]+\/buy\/?$/.test(path) || /^\/account\/verify\/?$/.test(path);
}

export function HideOnPaths({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isNoticeHiddenPath(pathname) ? null : <>{children}</>;
}
