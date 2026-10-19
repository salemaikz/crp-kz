// Мелкие общие части зоны покупки: телефон помощи, статус заказа.
import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@/lib/orders/types';
import { Badge, Card, type BadgeTone } from '@/components/ui';

/** Телефон ЦРП для вопросов по оплате (публичный, как на сайте crp.kz). */
export const CRP_PHONE = '+7 701 100 09 29';
const CRP_PHONE_HREF = 'tel:+77011000929';

/** Строка «Вопросы по оплате? Позвоните: …». */
export function HelpLine() {
  const t = useTranslations('checkout.common');
  return (
    <p className="co-help">
      {t.rich('help', {
        number: CRP_PHONE,
        phone: (chunks) => <a href={CRP_PHONE_HREF}>{chunks}</a>,
      })}
    </p>
  );
}

/** Карточка помощи: кому звонить по оплате и доступу. */
export function HelpCard() {
  const t = useTranslations('checkout.common');
  return (
    <Card className="co-steps-card" large>
      <h2 className="co-steps-card__title">{t('helpTitle')}</h2>
      <p className="co-result__text">{t('helpText')}</p>
      <p className="co-help co-help--plain">
        <a href={CRP_PHONE_HREF}>{CRP_PHONE}</a>
      </p>
    </Card>
  );
}

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  paid: 'success',
  cancelled: 'neutral',
  refunded: 'info',
};

/** Статус заказа: цвет всегда вместе с текстом. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('checkout.common.status');
  return (
    <Badge tone={STATUS_TONE[status]} dot data-status={status}>
      {t(status)}
    </Badge>
  );
}
