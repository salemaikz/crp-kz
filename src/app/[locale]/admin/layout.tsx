import type { ReactNode } from 'react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminNav } from '@/components/admin/AdminNav';
import '@/components/admin/admin.css';
import { countPendingOrders } from '@/lib/admin';
import { getCurrentUser } from '@/lib/auth';
import { routing } from '@/lib/i18n/routing';

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/**
 * Оболочка админки: слева меню (на телефоне — вкладки сверху), справа страница.
 * Права проверяет каждая страница (adminPage → редирект гостя на вход с возвратом, 404 для остальных);
 * здесь не-админу оболочку не рисуем и не редиректим, чтобы не затереть возврат на нужную страницу.
 */
export default async function AdminLayout({ children, params }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const user = await getCurrentUser();
  // страница ниже сама отправит гостя на вход (с возвратом) или покажет 404, а админке тут ничего нет
  if (!user || user.role !== 'admin') return <>{children}</>;
  const [t, pending] = await Promise.all([getTranslations('admin'), countPendingOrders(user)]);
  const roleLabel = t('enums.role.admin');

  return (
    <div className="container adm-shell" data-locale={locale}>
      <aside className="adm-side">
        <div className="adm-side__head">
          <div className="adm-side__user">
            <strong>{user.name || user.email}</strong>
            <span className="meta">{roleLabel}</span>
          </div>
        </div>
        <AdminNav pendingOrders={pending} />
      </aside>
      <div className="adm-main">{children}</div>
    </div>
  );
}
