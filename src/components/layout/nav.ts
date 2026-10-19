/** Пункт навигации шапки: путь без локали. */
export type NavItem = { href: string; label: string };

/** Активен ли пункт для текущего пути (без префикса локали). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
