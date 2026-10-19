'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { loginAction, type AuthFormState } from '@/lib/auth/actions';
import { Link } from '@/lib/i18n/navigation';
import { Alert, Field, Input, PasswordInput, SubmitButton } from '@/components/ui';

/** Форма входа: email + пароль, ошибки — сверху с иконкой, поле подсвечено. */
export function LoginForm({ next, showForgot = false }: { next?: string; showForgot?: boolean }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(loginAction, undefined);
  const error = state?.error;
  const invalid = error === 'invalid';

  return (
    <form action={formAction} className="auth-form">
      {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label={t('fields.email')} required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state?.values?.email}
          invalid={invalid}
        />
      </Field>
      <Field label={t('fields.password')} required>
        <PasswordInput name="password" autoComplete="current-password" invalid={invalid} />
      </Field>
      {showForgot && (
        <p className="auth__switch" style={{ textAlign: 'start' }}>
          <Link href="/password/forgot" className="text-link">
            {t('login.forgot')}
          </Link>
        </p>
      )}
      <SubmitButton size="lg" block pending={pending} pendingText={t('login.pending')} className="auth-form__submit">
        {t('login.submit')}
      </SubmitButton>
    </form>
  );
}
