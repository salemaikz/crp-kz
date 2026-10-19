'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { resendVerificationAction, type RecoveryState } from '@/lib/auth/recoveryActions';
import { SubmitButton } from '@/components/ui';

/** Кнопка «Отправить ещё раз» в плашке подтверждения email. next возвращает по ссылке из письма. */
export function ResendVerification({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(resendVerificationAction, undefined);
  const error = state?.status === 'error' ? state.error : undefined;

  return (
    <form action={formAction} style={{ marginTop: 8 }}>
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}
      <SubmitButton variant="ghost" size="sm" pending={pending} pendingText={t('verifyNotice.pending')}>
        {t('verifyNotice.resend')}
      </SubmitButton>
      {state?.status === 'sent' && (
        <span role="status" data-testid="verify-resent">
          {' '}
          {t('verifyNotice.resent')}
        </span>
      )}
      {error && (
        <span role="alert">
          {' '}
          {t(`errors.${error}`)}
        </span>
      )}
    </form>
  );
}
