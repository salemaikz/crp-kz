'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { resetPasswordAction, type RecoveryState } from '@/lib/auth/recoveryActions';
import { Link } from '@/lib/i18n/navigation';
import { useHashParams } from '@/components/account/useHashParams';
import { Alert, Button, Field, PasswordInput, SubmitButton } from '@/components/ui';

/** Новый пароль по ссылке из письма. Токен читается из #token=…, сразу убирается из адреса и уходит скрытым полем. */
export function ResetForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const hash = useHashParams();
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(resetPasswordAction, undefined);
  // после ошибки поле токена нужно сохранить: адрес уже очищен, а слабый пароль токен не тратит
  const token = hash?.get('token') ?? '';

  if (state?.status === 'done') {
    return (
      <div className="auth-form">
        <Alert tone="success" data-testid="reset-done">
          {t('reset.done')}
        </Alert>
        <Button href="/learn" size="lg" block>
          {t('reset.toLearn')}
        </Button>
      </div>
    );
  }
  if (hash === null) return null;
  if (!token) {
    return (
      <div className="auth-form">
        <Alert tone="warning">{t('reset.noToken')}</Alert>
        <Link href="/password/forgot" className="text-link">
          {t('reset.requestNew')}
        </Link>
      </div>
    );
  }
  const error = state?.status === 'error' ? state.error : undefined;
  const fieldError = error === 'weak_password' || error === 'validation' ? error : undefined;

  return (
    <form action={formAction} className="auth-form">
      {error && !fieldError && (
        <Alert tone="error">
          {t(`errors.${error}`)}
          {error === 'invalid_token' && (
            <>
              {' '}
              <Link href="/password/forgot">{t('reset.requestNew')}</Link>
            </>
          )}
        </Alert>
      )}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <Field
        label={t('fields.password')}
        required
        hint={t('fields.passwordHint')}
        error={fieldError ? t(`errors.${fieldError}`) : undefined}
      >
        <PasswordInput name="password" autoComplete="new-password" minLength={8} />
      </Field>
      <SubmitButton size="lg" block pending={pending} pendingText={t('reset.pending')} className="auth-form__submit">
        {t('reset.submit')}
      </SubmitButton>
    </form>
  );
}
