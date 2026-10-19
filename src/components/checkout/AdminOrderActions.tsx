'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { adminOrderAction } from '@/lib/orders/actions';
import type { OrderStatus } from '@/lib/orders/types';
import { Button, SubmitButton } from '@/components/ui';

type Op = 'paid' | 'cancel' | 'refund';

type Props = {
  orderId: string;
  number: string;
  email: string;
  status: OrderStatus;
  /** Текущая вкладка — вернуться на неё после действия. */
  filter: string;
};

const CONFIRM: Record<Op, { text: string; yes: string }> = {
  paid: { text: 'confirmPaid', yes: 'yesPaid' },
  cancel: { text: 'confirmCancel', yes: 'yesCancel' },
  refund: { text: 'confirmRefund', yes: 'yesRefund' },
};

/**
 * Действия по заказу с подтверждением в два шага: «Оплачено» → «Да, оплачено».
 * Проверки статуса и прав — на сервере (adminOrderAction); здесь только интерфейс.
 */
export function AdminOrderActions({ orderId, number, email, status, filter }: Props) {
  const t = useTranslations('checkout.admin.actions');
  const locale = useLocale();
  const [op, setOp] = useState<Op | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // после «Нет» возвращаем фокус на кнопку, которая открыла подтверждение
  const close = () => {
    const prev = op;
    setOp(null);
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`[data-op="${prev}"]`)?.focus());
  };

  let body;
  if (op) {
    const c = CONFIRM[op];
    body = (
      <form
        action={adminOrderAction}
        className="co-confirm"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="op" value={op} />
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="locale" value={locale} />
        <p className="co-confirm__text" role="alert">
          {t(c.text, { number, email })}
        </p>
        <div className="co-actions">
          <SubmitButton
            autoFocus
            size="sm"
            variant={op === 'paid' ? 'primary' : 'dark'}
            pendingText={t('pending')}
            data-testid={`confirm-${op}-${number}`}
          >
            {t(c.yes)}
          </SubmitButton>
          <Button size="sm" variant="ghost" onClick={close}>
            {t('no')}
          </Button>
        </div>
      </form>
    );
  } else if (status === 'pending') {
    body = (
      <div className="co-actions">
        <Button
          size="sm"
          variant="dark"
          onClick={() => setOp('paid')}
          data-op="paid"
          data-testid={`mark-paid-${number}`}
        >
          {t('paid')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOp('cancel')} data-op="cancel">
          {t('cancel')}
        </Button>
      </div>
    );
  } else if (status === 'paid') {
    body = (
      <div className="co-actions">
        <Button size="sm" variant="ghost" onClick={() => setOp('refund')} data-op="refund">
          {t('refund')}
        </Button>
      </div>
    );
  } else {
    body = <span className="co-cell-meta">{t('none')}</span>;
  }

  return <div ref={wrapRef}>{body}</div>;
}
