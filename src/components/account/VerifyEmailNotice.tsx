import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { Alert, Container } from '@/components/ui';
import { HideOnPaths } from './HideOnPaths';
import { ResendVerification } from './ResendVerification';

type Props = {
  /** banner — полоса под шапкой; checkout — вместо формы покупки (D-032, ждёт владельца). */
  variant?: 'banner' | 'checkout';
  /**
   * Куда вернуть после подтверждения (безопасный путь): уходит в письмо. Без него (плашка в layout)
   * кнопка берёт путь страницы, на которой нажата, без query.
   */
  next?: string;
};

/**
 * Плашка «Подтвердите email». Ничего не рисует, если функция выключена, пользователь не вошёл
 * или email уже подтверждён. В демо на варианте checkout подсказывает, где взять ссылку: писем в демо нет (К-22).
 */
export async function VerifyEmailNotice({ variant = 'banner', next }: Props) {
  if (!isFeatureActive('EMAIL_VERIFY')) return null;
  const user = await getCurrentUser();
  if (!user || user.emailVerified) return null;
  const t = await getTranslations('auth.verifyNotice');

  const body = (
    <Alert tone="info" data-testid={variant === 'checkout' ? 'verify-notice-checkout' : 'verify-notice'}>
      {t(variant === 'checkout' ? 'checkout' : 'text', { email: user.email })}
      {variant === 'checkout' && isDemo() && (
        <>
          {' '}
          <span data-testid="verify-demo-hint">{t('demoHint')}</span>
        </>
      )}
      <ResendVerification next={next} />
    </Alert>
  );
  return variant === 'banner' ? (
    // на покупке (свой вариант checkout) и на /account/verify плашка скрыта
    <HideOnPaths>
      <Container>
        <div style={{ paddingBlock: 12 }}>{body}</div>
      </Container>
    </HideOnPaths>
  ) : (
    body
  );
}
