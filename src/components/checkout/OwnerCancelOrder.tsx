'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cancelOwnOrderAction } from '@/lib/orders/actions';
import { Button, SubmitButton } from '@/components/ui';

type Props = { orderId: string; number: string };

/**
 * Отмена своего неоплаченного заказа в два шага: «Отменить заказ» → «Да, отменить».
 * Права (только владелец по сессии) и статус проверяет сервер (cancelOwnOrderAction).
 */
export function OwnerCancelOrder({ orderId, number }: Props) {
  const t = useTranslations('checkout.order.ownerCancel');
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!confirming) {
    return (
      <div className="co-owner-cancel" ref={wrapRef}>
        <p className="co-owner-cancel__hint">{t('hint')}</p>
        <div className="co-actions">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} data-testid="owner-cancel-order">
            {t('button')}
          </Button>
        </div>
      </div>
    );
  }

  const close = () => {
    setConfirming(false);
    // после «Нет» фокус возвращается на кнопку «Отменить заказ»
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>('[data-testid="owner-cancel-order"]')?.focus());
  };

  return (
    <form
      action={cancelOwnOrderAction}
      className="co-confirm co-owner-cancel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="locale" value={locale} />
      <p className="co-confirm__text" role="alert">
        {t('confirm', { number })}
      </p>
      <div className="co-actions">
        <SubmitButton autoFocus size="sm" variant="dark" pendingText={t('pending')} data-testid="owner-cancel-confirm">
          {t('yes')}
        </SubmitButton>
        <Button size="sm" variant="ghost" onClick={close}>
          {t('no')}
        </Button>
      </div>
    </form>
  );
}
