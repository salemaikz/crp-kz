import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { isDemo } from '@/lib/env';
import { safeNext } from '@/lib/auth/safeNext';
import { isLegalEnabled, legalAllowDrafts, REGISTER_CONSENTS, versionsToken } from '@/lib/legal';
import { Link } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { AuthShell } from '@/components/layout/AuthShell';
import { ConsentLabel } from '@/components/legal/ConsentLabel';
import { Alert } from '@/components/ui';
import { RegisterForm } from './RegisterForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return { title: t('metaTitle') };
}

export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);

  const sp = await searchParams;
  const next = safeNext(sp.next) ?? undefined;
  if (await getCurrentUser()) redirect(next ?? `/${locale}/learn`);
  const t = await getTranslations('auth');
  // при активном LEGAL подпись — со ссылками на документы, а форма отправляет токен показанных версий
  const legalOn = isLegalEnabled();
  const legal = { enabled: legalOn, token: legalOn ? versionsToken(REGISTER_CONSENTS, { allowDrafts: legalAllowDrafts() }) : '' };

  return (
    <AuthShell title={t('register.title')} lead={t('register.lead')}>
      {/* демо: данные на Vercel (вне РК) и сбрасываются — реальные ПДн вводить нельзя */}
      {isDemo() && (
        <Alert tone="warning" role="note" style={{ marginBottom: 16 }}>
          {t('register.demoWarning')}
        </Alert>
      )}
      <RegisterForm
        next={next}
        legal={legal}
        consentLabel={legalOn ? <ConsentLabel id="register" locale={locale} /> : t('register.consent')}
      />
      <p className="auth__switch">
        {t('register.haveAccount')}{' '}
        <Link href={next ? { pathname: '/login', query: { next } } : '/login'} className="text-link">
          {t('register.toLogin')}
        </Link>
      </p>
    </AuthShell>
  );
}
