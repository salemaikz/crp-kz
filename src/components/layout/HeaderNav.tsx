'use client';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { isActivePath, type NavItem } from './nav';

/** Навигация шапки на десктопе: подсветка текущего раздела красной чертой. */
export function HeaderNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
