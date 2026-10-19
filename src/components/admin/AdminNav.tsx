'use client';

import { ClipboardList, GraduationCap, LayoutDashboard, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/navigation';

type Props = {
  /** Заказов ждёт оплаты — значок на пункте «Заказы». */
  pendingOrders: number;
};

const ITEMS = [
  { href: '/admin', key: 'dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/courses', key: 'courses', icon: GraduationCap },
  { href: '/admin/orders', key: 'orders', icon: ClipboardList },
  { href: '/admin/users', key: 'users', icon: Users },
] as const;

/** Навигация админки: боковая панель на десктопе, прокручиваемые вкладки на телефоне. */
export function AdminNav({ pendingOrders }: Props) {
  const t = useTranslations('admin.shell');
  const pathname = usePathname();
  return (
    <nav className="adm-nav" aria-label={t('navLabel')}>
      <ul>
        {ITEMS.map(({ href, key, icon: Icon, ...rest }) => {
          const exact = 'exact' in rest;
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const badge = key === 'orders' && pendingOrders > 0 ? pendingOrders : 0;
          return (
            <li key={href}>
              <Link href={href} className="adm-nav__link" aria-current={active ? 'page' : undefined} data-testid={`admin-nav-${key}`}>
                <Icon aria-hidden="true" />
                <span>{t(`nav.${key}`)}</span>
                {badge > 0 && (
                  <span className="adm-nav__badge" title={t('pendingBadge', { count: badge })}>
                    <span aria-hidden="true">{badge}</span>
                    <span className="visually-hidden">{t('pendingBadge', { count: badge })}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
