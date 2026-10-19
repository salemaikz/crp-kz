'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/navigation';

type Props = {
  /** Заказов ждёт оплаты — значок на пункте «Заказы». */
  pendingOrders: number;
  /** Есть ли активная почтовая функция: тогда виден пункт «Письма». Значение приходит с сервера. */
  mailPages: boolean;
};

const ITEMS = [
  { href: '/admin', key: 'dashboard', exact: true },
  { href: '/admin/courses', key: 'courses' },
  { href: '/admin/orders', key: 'orders' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/mail', key: 'mail' },
] as const;

/** Навигация админки: боковая панель на десктопе, прокручиваемые вкладки на телефоне. Только текст, без значков. */
export function AdminNav({ pendingOrders, mailPages }: Props) {
  const t = useTranslations('admin.shell');
  const pathname = usePathname();
  return (
    <nav className="adm-nav" aria-label={t('navLabel')}>
      <ul>
        {ITEMS.filter((item) => item.key !== 'mail' || mailPages).map(({ href, key, ...rest }) => {
          const exact = 'exact' in rest;
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const badge = key === 'orders' && pendingOrders > 0 ? pendingOrders : 0;
          return (
            <li key={href}>
              <Link href={href} className="adm-nav__link" aria-current={active ? 'page' : undefined} data-testid={`admin-nav-${key}`}>
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
