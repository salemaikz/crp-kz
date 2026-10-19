'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { registerAction, type AuthFormState } from '@/lib/auth/actions';
import { Link } from '@/lib/i18n/navigation';
import { Alert, Checkbox, Field, Input, PasswordInput, SubmitButton } from '@/components/ui';

/** Форма регистрации: имя, email, пароль и обязательное согласие на обработку ПДн. */
export function RegisterForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(registerAction, undefined);
  const error = state?.error;
  // ошибки, привязанные к полю, показываем у поля; остальные — сверху
  const fieldError = error === 'weak_password' || error === 'consent' ? error : undefined;
  const formError = error && !fieldError ? error : undefined;

  return (
    <form action={formAction} className="auth-form">
      {formError && (
        <Alert tone="error">
          {t(`errors.${formError}`)}
          {formError === 'exists' && (
            <>
              {' '}
              <Link href={next ? { pathname: '/login', query: { next } } : '/login'}>{t('register.toLogin')}</Link>
            </>
          )}
        </Alert>
      )}
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label={t('fields.name')} required hint={t('fields.nameHint')}>
        <Input
          name="name"
          autoComplete="name"
          maxLength={120}
          defaultValue={state?.values?.name}
          invalid={formError === 'validation'}
        />
      </Field>
      <Field label={t('fields.email')} required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state?.values?.email}
          invalid={formError === 'exists' || formError === 'validation'}
        />
      </Field>
      <Field
        label={t('fields.password')}
        required
        hint={t('fields.passwordHint')}
        error={fieldError === 'weak_password' ? t('errors.weak_password') : undefined}
      >
        <PasswordInput name="password" autoComplete="new-password" minLength={8} />
      </Field>
      <Checkbox
        name="consent"
        required
        label={t('register.consent')}
        error={fieldError === 'consent' ? t('errors.consent') : undefined}
      />
      <SubmitButton size="lg" block pending={pending} pendingText={t('register.pending')} className="auth-form__submit">
        {t('register.submit')}
      </SubmitButton>
    </form>
  );
}
