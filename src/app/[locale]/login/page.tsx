import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { safeNext } from '@/lib/auth/safeNext';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { Link } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { AuthShell } from '@/components/layout/AuthShell';
import { DemoAccess } from './DemoAccess';
import { LoginForm } from './LoginForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'auth.login' });
  return { title: t('metaTitle') };
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);

  const sp = await searchParams;
  const next = safeNext(sp.next) ?? undefined;
  // уже вошёл — туда, куда шёл, или в «Моё обучение»
  if (await getCurrentUser()) redirect(next ?? `/${locale}/learn`);
  const t = await getTranslations('auth');

  return (
    <AuthShell title={t('login.title')} lead={t('login.lead')}>
      <LoginForm next={next} showForgot={isFeatureActive('PASSWORD_RESET')} />
      <p className="auth__switch">
        {t('login.noAccount')}{' '}
        <Link href={next ? { pathname: '/register', query: { next } } : '/register'} className="text-link">
          {t('login.toRegister')}
        </Link>
      </p>
      {isDemo() && <DemoAccess locale={locale} next={next} />}
    </AuthShell>
  );
}
