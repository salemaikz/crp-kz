'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { requestPasswordResetAction, type RecoveryState } from '@/lib/auth/recoveryActions';
import { Link } from '@/lib/i18n/navigation';
import { Alert, Field, Input, SubmitButton } from '@/components/ui';

/** Запрос ссылки для нового пароля. Ответ один и тот же, есть аккаунт или нет. */
export function ForgotForm({ demo }: { demo: boolean }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(requestPasswordResetAction, undefined);

  if (state?.status === 'sent') {
    return (
      <div className="auth-form">
        <Alert tone="success" data-testid="forgot-sent">
          {t('forgot.sent', { email: state.email })}
          {demo && <> {t('forgot.demoSent')}</>}
        </Alert>
        <p className="auth__switch">
          <Link href="/login" className="text-link">
            {t('forgot.backToLogin')}
          </Link>
        </p>
      </div>
    );
  }
  const error = state?.status === 'error' ? state.error : undefined;

  return (
    <form action={formAction} className="auth-form">
      {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}
      <input type="hidden" name="locale" value={locale} />
      <Field label={t('fields.email')} required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          invalid={error === 'validation'}
        />
      </Field>
      <SubmitButton size="lg" block pending={pending} pendingText={t('forgot.pending')} className="auth-form__submit">
        {t('forgot.submit')}
      </SubmitButton>
      <p className="auth__switch">
        <Link href="/login" className="text-link">
          {t('forgot.backToLogin')}
        </Link>
      </p>
    </form>
  );
}
