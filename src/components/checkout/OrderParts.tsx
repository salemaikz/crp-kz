// Блоки страницы заказа: детали, оплата Kaspi, оплата по счёту, итог, подсказка демо.
import type { ReactNode } from 'react';
import { CalendarCheck, CircleCheck, FileText, QrCode, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { demoLoginAction } from '@/lib/auth/actions';
import { DEMO_ACCOUNTS } from '@/lib/auth/demo';
import { t as tl } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDate, formatPrice } from '@/lib/format';
import { SELLER, type OrderView } from '@/lib/orders/types';
import { Button, Card, Eyebrow } from '@/components/ui';
import { CopyButton } from './CopyButton';
import { OrderStatusBadge } from './parts';

type WithOrder = { order: OrderView; locale: Locale };

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `co-details__row ${className}` : 'co-details__row'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Детали заказа: номер, даты, курс, покупатель, способ оплаты, сумма. */
export function OrderDetails({ order, locale }: WithOrder) {
  const t = useTranslations('checkout');
  const d = (key: string) => t(`order.details.${key}`);
  return (
    <Card large className="co-details-card">
      <h2 className="co-steps-card__title">{d('title')}</h2>
      <dl className="co-details">
        <Row label={d('number')}>{order.number}</Row>
        <Row label={d('status')}>
          <OrderStatusBadge status={order.status} />
        </Row>
        <Row label={d('created')}>{formatDate(order.createdAt, locale, { withTime: true })}</Row>
        {order.paidAt && order.status !== 'pending' && (
          <Row label={d('paidAt')}>{formatDate(order.paidAt, locale, { withTime: true })}</Row>
        )}
        <Row label={d('course')}>{tl(order.courseTitle, locale)}</Row>
        <Row label={d('access')}>
          {order.accessDays ? t('common.accessDays', { days: order.accessDays }) : t('common.accessForever')}
        </Row>
        <Row label={d('buyer')}>{order.buyerName}</Row>
        {order.buyerType === 'company' && order.companyName && (
          <Row label={d('company')}>
            {order.companyName}
            {order.companyBin && <span className="co-cell-meta">{`${d('bin')} ${order.companyBin}`}</span>}
          </Row>
        )}
        <Row label={d('email')}>{order.buyerEmail}</Row>
        <Row label={d('phone')}>{order.buyerPhone}</Row>
        <Row label={d('method')}>{t(`common.method.${order.paymentMethod}`)}</Row>
        <Row label={d('amount')} className="co-details__total">
          {formatPrice(order.amountKzt, locale)}
        </Row>
      </dl>
    </Card>
  );
}

/** Инструкция оплаты через Kaspi: шаги, место под QR (без фейкового кода), реквизиты с копированием. */
export function KaspiPayment({ order, locale }: WithOrder) {
  const t = useTranslations('checkout');
  const k = (key: string) => t(`order.kaspi.${key}`);
  const amount = formatPrice(order.amountKzt, locale);
  const copy = (value: string) => (
    <CopyButton
      value={value}
      label={t('common.copy')}
      copiedLabel={t('common.copied')}
      ariaLabel={t('common.copyLabel', { value })}
    />
  );
  return (
    <Card large padding="lg" className="co-pay">
      <h2 className="co-card-title">{k('title')}</h2>
      <div className="co-pay__grid">
        <ol className="co-steps">
          <li>
            <span>{k('step1')}</span>
          </li>
          <li>
            <span>{k('step2')}</span>
          </li>
          <li>
            <span>{k('step3')}</span>
          </li>
          <li>
            <span>{k('step4')}</span>
          </li>
        </ol>
        <div className="co-qr" data-testid="kaspi-qr-placeholder">
          <span className="co-qr__icon" aria-hidden="true">
            <QrCode />
          </span>
          <span className="co-qr__title">{k('qrTitle')}</span>
          <p className="co-qr__text">{k('qrText')}</p>
        </div>
      </div>
      <dl className="co-fields">
        <div className="co-fields__row">
          <dt>{k('recipient')}</dt>
          <dd>
            <span>{SELLER.name}</span>
            {copy(SELLER.name)}
          </dd>
        </div>
        <div className="co-fields__row">
          <dt>{k('amount')}</dt>
          <dd>
            <span>{amount}</span>
            {copy(String(order.amountKzt))}
          </dd>
        </div>
        <div className="co-fields__row">
          <dt>{k('comment')}</dt>
          <dd>
            <span data-testid="order-number">{order.number}</span>
            {copy(order.number)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** Оплата по счёту: превью документа и ссылка на печатный счёт. */
export function InvoicePayment({ order, locale, invoiceHref }: WithOrder & { invoiceHref: string }) {
  const t = useTranslations('checkout.order.invoice');
  return (
    <Card large padding="lg" className="co-pay">
      <h2 className="co-card-title">{t('title')}</h2>
      <p className="co-result__text">{t('text', { number: order.number })}</p>
      <div className="co-doc-teaser">
        <span className="co-doc-teaser__icon" aria-hidden="true">
          <FileText />
        </span>
        <div>
          <div className="co-doc-teaser__title">{t('docTitle', { number: order.number })}</div>
          <div className="co-doc-teaser__meta">
            {t('docMeta', {
              amount: formatPrice(order.amountKzt, locale),
              date: formatDate(order.createdAt, locale),
            })}
          </div>
        </div>
      </div>
      <div className="co-actions-row">
        <Button href={invoiceHref} variant="primary">
          <FileText aria-hidden="true" />
          {t('open')}
        </Button>
      </div>
    </Card>
  );
}

type PaidProps = WithOrder & {
  /** Действующий доступ: срок окончания (null — бессрочно) или closed. */
  access: { state: 'active'; expiresAt: number | null } | { state: 'closed' };
  /** Как зритель может перейти к курсу. */
  cta: 'learn' | 'signin' | 'no_account';
  signInHref: string;
  demo: boolean;
};

/** Итог оплаченного заказа: доступ и переход к обучению (или как войти, если аккаунт новый). */
export function PaidResult({ order, locale, access, cta, signInHref, demo }: PaidProps) {
  const t = useTranslations('checkout.order.paid');
  return (
    <Card large padding="lg" className="co-result" data-testid="order-paid">
      <span className="co-result__icon co-result__icon--success" aria-hidden="true">
        <CircleCheck />
      </span>
      <h2 className="co-card-title">{tl(order.courseTitle, locale)}</h2>
      <p className="co-access">
        <CalendarCheck aria-hidden="true" />
        {access.state === 'closed'
          ? t('accessClosed')
          : access.expiresAt
            ? t('accessUntil', { date: formatDate(access.expiresAt, locale) })
            : t('accessForever')}
      </p>
      {cta === 'learn' && (
        <Button href={`/learn/${order.courseSlug}`} variant="primary" size="lg">
          {t('toLearn')}
        </Button>
      )}
      {cta === 'signin' && (
        <Button href={signInHref} variant="primary" size="lg">
          {t('signInToLearn')}
        </Button>
      )}
      {cta === 'no_account' && (
        <div className="co-demo">
          <Eyebrow>{t('noAccountTitle')}</Eyebrow>
          <p className="co-result__text">{t('noAccountText', { email: order.buyerEmail })}</p>
          {demo && <p className="co-hint">{t('demoNote')}</p>}
        </div>
      )}
    </Card>
  );
}

/** Итог отменённого или возвращённого заказа. */
export function ClosedResult({ order }: { order: OrderView }) {
  const t = useTranslations('checkout.order');
  const cancelled = order.status === 'cancelled';
  return (
    <Card large padding="lg" className="co-result">
      <span className="co-result__icon co-result__icon--muted" aria-hidden="true">
        {cancelled ? <XCircle /> : <RotateCcw />}
      </span>
      <p className="co-result__text">{t(`lead.${cancelled ? 'cancelled' : 'refunded'}`)}</p>
      <div className="co-actions-row">
        {cancelled && (
          <Button href={`/courses/${order.courseSlug}/buy`} variant="primary">
            {t('cancelled.again')}
          </Button>
        )}
        <Button href="/courses" variant="ghost">
          {t(cancelled ? 'cancelled.courses' : 'refunded.courses')}
        </Button>
      </div>
    </Card>
  );
}

/** Демо: подсказка подтвердить оплату под администратором (вход в один клик). */
export function DemoAdminHint({ locale, viewerIsAdmin }: { locale: Locale; viewerIsAdmin: boolean }) {
  const t = useTranslations('checkout.order.demo');
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  return (
    <aside className="co-demo" data-testid="demo-admin-hint">
      <Eyebrow>{t('title')}</Eyebrow>
      <p className="co-demo__text">{t('text')}</p>
      <div className="co-actions-row">
        {viewerIsAdmin || !admin ? (
          <Button href="/admin/orders?status=pending" variant="dark" size="sm">
            <ShieldCheck aria-hidden="true" />
            {t('open')}
          </Button>
        ) : (
          <form action={demoLoginAction}>
            <input type="hidden" name="email" value={admin.email} />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={`/${locale}/admin/orders?status=pending`} />
            <Button type="submit" variant="dark" size="sm">
              <ShieldCheck aria-hidden="true" />
              {t('login')}
            </Button>
          </form>
        )}
      </div>
    </aside>
  );
}
