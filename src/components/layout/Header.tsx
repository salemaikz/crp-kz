import Image from 'next/image';
import { unstable_rethrow } from 'next/navigation';
import { LogIn, LogOut } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, getMemberships } from '@/lib/auth';
import { logoutAction } from '@/lib/auth/actions';
import { Link } from '@/lib/i18n/navigation';
import { Avatar, Button } from '@/components/ui';
import { HeaderNav } from './HeaderNav';
import { LangSwitch } from './LangSwitch';
import { MobileMenu } from './MobileMenu';
import type { NavItem } from './nav';

type Viewer = {
  user: { id: string; name: string; email: string; role: 'admin' | 'author' | 'learner' } | null;
  isManager: boolean;
};

async function loadViewer(): Promise<Viewer> {
  try {
    const user = await getCurrentUser();
    if (!user) return { user: null, isManager: false };
    const memberships = await getMemberships(user.id);
    return { user, isManager: memberships.some((m) => m.role === 'manager') };
  } catch (err) {
    // служебные исключения Next (динамический рендер, redirect) пробрасываем
    unstable_rethrow(err);
    console.error('[header] не удалось получить пользователя', err);
    return { user: null, isManager: false };
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Шапка: тёмная полупрозрачная, логотип, разделы по ролям, язык, вход/выход. */
export async function Header() {
  const [t, locale, { user, isManager }] = await Promise.all([
    getTranslations('common'),
    getLocale(),
    loadViewer(),
  ]);

  const items: NavItem[] = [{ href: '/courses', label: t('nav.courses') }];
  if (user) items.push({ href: '/learn', label: t('nav.learn') });
  if (isManager) items.push({ href: '/team', label: t('nav.team') });
  if (user?.role === 'admin') items.push({ href: '/admin', label: t('nav.admin') });

  const logoutForm = (className: string, withText: boolean) => (
    <form action={logoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className={className}>
        <LogOut aria-hidden="true" />
        {withText && t('header.logout')}
      </button>
    </form>
  );

  const mobileFooter = user ? (
    <>
      <div className="mobile-panel__user">
        <Avatar name={user.name || user.email} tone="light" />
        <span>
          {t('header.signedInAs')}
          <strong>{user.name || user.email}</strong>
        </span>
      </div>
      {logoutForm('btn btn--ghost btn--block', true)}
    </>
  ) : (
    <>
      <Button href="/courses" variant="primary" block>
        {t('header.chooseCourse')}
      </Button>
      <Button href="/login" variant="ghost" block>
        <LogIn aria-hidden="true" />
        {t('header.login')}
      </Button>
    </>
  );

  return (
    <header className="site-header on-night">
      <div className="container site-header__row">
        <Link href="/" className="site-header__brand" aria-label={t('a11y.home')}>
          <Image
            src="/brand/crp-logo-white.svg"
            alt={t('brand.logoAlt')}
            width={235}
            height={49}
            loading="eager"
            unoptimized
          />
        </Link>

        <HeaderNav items={items} label={t('a11y.mainNav')} />

        <div className="site-header__actions">
          <LangSwitch
            label={t('a11y.language')}
            labels={{
              ru: { short: t('lang.ru'), full: t('lang.ruFull') },
              kz: { short: t('lang.kz'), full: t('lang.kzFull') },
            }}
          />
          {user ? (
            <div className="user-chip site-header__desktop">
              <Avatar name={user.name || user.email} size="sm" tone="light" />
              <span className="user-chip__name" title={user.email}>
                {firstName(user.name || user.email)}
              </span>
              {logoutForm('logout-btn', true)}
            </div>
          ) : (
            <>
              <Link href="/login" className="site-header__login">
                {t('header.login')}
              </Link>
              <Button href="/courses" variant="primary" size="sm" className="site-header__cta">
                {t('header.chooseCourse')}
              </Button>
            </>
          )}
          <MobileMenu
            items={items}
            navLabel={t('a11y.mainNav')}
            openLabel={t('a11y.openMenu')}
            closeLabel={t('a11y.closeMenu')}
            footer={mobileFooter}
          />
        </div>
      </div>
    </header>
  );
}
