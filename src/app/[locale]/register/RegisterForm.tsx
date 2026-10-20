'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { registerAction, type AuthFormState } from '@/lib/auth/actions';
import { Link } from '@/lib/i18n/navigation';
import { Alert, Checkbox, Field, Input, PasswordInput, SubmitButton } from '@/components/ui';

type Props = {
  next?: string;
  /** LEGAL: токен показанных версий документов уходит скрытым полем. */
  legal: { enabled: boolean; token: string };
  /** Подпись галочки: со ссылками на документы (LEGAL) или прежний текст. */
  consentLabel: ReactNode;
};

/** Форма регистрации: имя, email, пароль и обязательное согласие на обработку ПДн. */
export function RegisterForm({ next, legal, consentLabel }: Props) {
  const t = useTranslations('auth');
  const tLegal = useTranslations('legal.consent');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(registerAction, undefined);
  const error = state?.error;
  const router = useRouter();
  // последний выданный токен версий: следующая ошибка другого типа не должна откатывать его к пропу
  const [token, setToken] = useState(legal.token);
  if (state?.legalToken && state.legalToken !== token) setToken(state.legalToken);
  // режим формы расходится с серверным (LEGAL включился или выключился): перечитываем страницу
  useEffect(() => {
    if (state?.error === 'legal_changed') router.refresh();
  }, [state, router]);
  // ошибки, привязанные к полю, показываем у поля; остальные — сверху
  const fieldError = error === 'weak_password' || error === 'consent' ? error : undefined;
  const formError = error && !fieldError ? error : undefined;

  return (
    <form action={formAction} className="auth-form">
      {formError && (
        <Alert tone="error">
          {formError === 'legal_changed' ? tLegal('changed') : t(`errors.${formError}`)}
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
      {legal.enabled && <input type="hidden" name="legalToken" value={token} />}
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
        label={consentLabel}
        error={fieldError === 'consent' ? t('errors.consent') : undefined}
      />
      <SubmitButton size="lg" block pending={pending} pendingText={t('register.pending')} className="auth-form__submit">
        {t('register.submit')}
      </SubmitButton>
    </form>
  );
}
