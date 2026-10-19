'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { verifyEmailAction, type RecoveryState } from '@/lib/auth/recoveryActions';
import { Link } from '@/lib/i18n/navigation';
import { useHashParams } from '@/components/account/useHashParams';
import { Alert, Button, SubmitButton } from '@/components/ui';

/**
 * Кнопка подтверждения email (POST). Токен и next — из фрагмента #token=…&next=… (next уже безопасный путь
 * с локалью, поэтому переход — через router из next/navigation). Вошедший владелец уходит на next сразу;
 * без входа подтверждение не делает вход, а предлагает его.
 */
export function VerifyEmail() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const hash = useHashParams();
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(verifyEmailAction, undefined);
  const token = hash?.get('token') ?? '';
  const next = hash?.get('next') ?? '';

  const done = state?.status === 'done' ? state : null;
  const target = done?.loggedIn && done.next ? done.next : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (done) {
    return (
      <div className="auth-form">
        <Alert tone="success" data-testid="verify-done">
          {done.loggedIn ? t('verify.done') : t('verify.doneLogin')}
        </Alert>
        {done.loggedIn ? (
          <Button href={done.next ?? '/learn'} external={Boolean(done.next)} size="lg" block>
            {t('verify.continue')}
          </Button>
        ) : (
          <Button href={done.next ? `/login?next=${encodeURIComponent(done.next)}` : '/login'} size="lg" block>
            {t('verify.toLogin')}
          </Button>
        )}
      </div>
    );
  }
  if (hash === null) return null;
  if (!token) {
    return (
      <div className="auth-form">
        <Alert tone="warning">{t('verify.noToken')}</Alert>
      </div>
    );
  }
  const error = state?.status === 'error' ? state.error : undefined;

  return (
    <form action={formAction} className="auth-form">
      {error && (
        <Alert tone="error">
          {t(`errors.${error}`)}
          {error === 'invalid_token' && (
            <>
              {' '}
              <Link href="/login">{t('verify.toLogin')}</Link>
            </>
          )}
        </Alert>
      )}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      {next && <input type="hidden" name="next" value={next} />}
      <SubmitButton size="lg" block pending={pending} pendingText={t('verify.pending')} className="auth-form__submit">
        {t('verify.submit')}
      </SubmitButton>
    </form>
  );
}
