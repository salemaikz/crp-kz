'use client';

import { useActionState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { resendVerificationAction, type RecoveryState } from '@/lib/auth/recoveryActions';
import { SubmitButton } from '@/components/ui';

/**
 * Кнопка «Отправить письмо» в плашке подтверждения email. next возвращает по ссылке из письма;
 * не задан — берётся путь текущей страницы БЕЗ query (в нём может быть ключ доступа к заказу,
 * а письмо уходит на ещё не подтверждённый адрес). Форма отправляется и до гидрации.
 */
export function ResendVerification({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(resendVerificationAction, undefined);
  const error = state?.status === 'error' ? state.error : undefined;

  return (
    <form action={formAction} style={{ marginTop: 8 }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next ?? pathname} />
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
