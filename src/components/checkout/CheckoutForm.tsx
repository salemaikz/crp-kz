'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createOrderAction, type CheckoutFormState } from '@/lib/orders/actions';
import type { BuyerType, PaymentMethod } from '@/lib/orders/types';
import type { CheckoutErrors, CheckoutField, CheckoutValues } from '@/lib/orders/validation';
import { formatPrice } from '@/lib/format';
import { Alert, Checkbox, Field, Input, SubmitButton } from '@/components/ui';

type Props = {
  courseSlug: string;
  priceKzt: number;
  /** Вошедший пользователь (покупка только после входа, D-020): имя подставляется, email — аккаунта. */
  user: { name: string; email: string };
  /** LEGAL активен: две галочки (D-035) и токен показанных версий; иначе прежняя одна. */
  legal: { enabled: boolean; token: string };
  /** Подписи галочек со ссылками на документы (только при legal.enabled). */
  consentLabels?: { offer: ReactNode; pd: ReactNode };
};

const EMPTY: CheckoutValues = {
  buyerType: 'person',
  name: '',
  email: '',
  phone: '',
  companyName: '',
  companyBin: '',
  paymentMethod: 'kaspi',
  consent: false,
  consentOffer: false,
  consentPd: false,
};

/**
 * Форма покупки: кто покупает, контакты, реквизиты компании, способ оплаты, согласие.
 * После ошибки форма перемонтируется (key = номер попытки) и берёт введённые значения из ответа.
 */
export function CheckoutForm({ courseSlug, priceKzt, user, legal, consentLabels }: Props) {
  const [state, formAction, pending] = useActionState<CheckoutFormState, FormData>(createOrderAction, undefined);
  const initial: CheckoutValues = state?.values ?? { ...EMPTY, name: user.name, email: user.email };
  const router = useRouter();
  // последний выданный токен версий: ошибка другого типа не должна откатывать его к пропу
  const [token, setToken] = useState(legal.token);
  if (state?.legalToken && state.legalToken !== token) setToken(state.legalToken);
  // режим формы расходится с серверным (LEGAL включился или выключился): перечитываем страницу
  useEffect(() => {
    if (state?.error === 'legal_changed') router.refresh();
  }, [state, router]);
  return (
    <CheckoutFields
      key={state?.attempt ?? 0}
      formAction={formAction}
      pending={pending}
      state={state}
      initial={initial}
      courseSlug={courseSlug}
      priceKzt={priceKzt}
      user={user}
      legal={{ enabled: legal.enabled, token }}
      consentLabels={consentLabels}
    />
  );
}

type FieldsProps = Props & {
  formAction: (fd: FormData) => void;
  pending: boolean;
  state: CheckoutFormState;
  initial: CheckoutValues;
};

function CheckoutFields({
  formAction,
  pending,
  state,
  initial,
  courseSlug,
  priceKzt,
  user,
  legal,
  consentLabels,
}: FieldsProps) {
  const t = useTranslations('checkout.form');
  const tErr = useTranslations('checkout.errors');
  const tLegal = useTranslations('legal.consent');
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [buyerType, setBuyerType] = useState<BuyerType>(initial.buyerType);
  const [method, setMethod] = useState<PaymentMethod>(
    initial.buyerType === 'company' ? 'invoice' : initial.paymentMethod,
  );
  const errors: CheckoutErrors = state?.errors ?? {};
  const err = (field: CheckoutField) => (errors[field] ? t(`errors.${field}.${errors[field]}`) : undefined);
  const company = buyerType === 'company';

  // после ошибки — фокус на первое поле с ошибкой (форма только что перемонтировалась)
  useEffect(() => {
    if (!state?.errors) return;
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  }, [state]);

  const chooseBuyer = (next: BuyerType) => {
    setBuyerType(next);
    if (next === 'company') setMethod('invoice');
  };

  const generalError =
    state && state.error !== 'validation'
      ? state.error === 'legal_changed'
        ? tLegal('changed')
        : state.error === 'email_unverified'
          ? tErr('email_unverified')
          : t(`alerts.${state.error}`)
      : null;
  const generalField = errors.courseSlug ? err('courseSlug') : null;

  return (
    <form ref={formRef} action={formAction} className="co-form" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="courseSlug" value={courseSlug} />
      {legal.enabled && <input type="hidden" name="legalToken" value={legal.token} />}

      {state?.error === 'validation' && <Alert tone="error">{generalField ?? t('alerts.validation')}</Alert>}
      {generalError && <Alert tone="error">{generalError}</Alert>}

      <div className="co-section">
        <fieldset className="co-fieldset">
          <legend className="co-legend">
            {t('who.legend')}
          </legend>
          <div className="co-choices">
            <Choice
              name="buyerType"
              value="person"
              checked={buyerType === 'person'}
              onChange={() => chooseBuyer('person')}
              title={t('who.person')}
              desc={t('who.personDesc')}
            />
            <Choice
              name="buyerType"
              value="company"
              checked={company}
              onChange={() => chooseBuyer('company')}
              title={t('who.company')}
              desc={t('who.companyDesc')}
            />
          </div>
        </fieldset>
      </div>

      <div className="co-section">
        <fieldset className="co-fieldset">
          <legend className="co-legend">
            {t('contacts.legend')}
          </legend>
          <Field label={t('contacts.name')} hint={t('contacts.nameHint')} error={err('name')} required>
            <Input name="name" autoComplete="name" maxLength={100} defaultValue={initial.name} />
          </Field>
          <div className="co-row co-row--2">
            <Field label={t('contacts.email')} hint={t('contacts.emailHintUser')} error={err('email')} required>
              {/* email аккаунта: заказ привязывается к нему, сервер берёт email из сессии */}
              <Input name="email" type="email" autoComplete="email" readOnly value={user.email} />
            </Field>
            <Field label={t('contacts.phone')} hint={t('contacts.phoneHint')} error={err('phone')} required>
              <Input
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+7 700 123 45 67"
                maxLength={32}
                defaultValue={initial.phone}
              />
            </Field>
          </div>
          {company && (
            <div className="co-row co-row--bin">
              <Field label={t('company.name')} error={err('companyName')} required>
                <Input
                  name="companyName"
                  autoComplete="organization"
                  placeholder={t('company.namePlaceholder')}
                  maxLength={200}
                  defaultValue={initial.companyName}
                />
              </Field>
              <Field label={t('company.bin')} hint={t('company.binHint')} error={err('companyBin')} required>
                <Input
                  name="companyBin"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000000000000"
                  maxLength={14}
                  defaultValue={initial.companyBin}
                />
              </Field>
            </div>
          )}
        </fieldset>
      </div>

      <div className="co-section">
        <fieldset className="co-fieldset" aria-describedby={errors.paymentMethod ? 'payment-error' : undefined}>
          <legend className="co-legend">
            {t('payment.legend')}
          </legend>
          <div className="co-choices" aria-invalid={errors.paymentMethod ? true : undefined}>
            <Choice
              name="paymentMethod"
              value="kaspi"
              checked={method === 'kaspi'}
              disabled={company}
              onChange={() => setMethod('kaspi')}
              title={t('payment.kaspi')}
              desc={t('payment.kaspiDesc')}
            />
            <Choice
              name="paymentMethod"
              value="invoice"
              checked={method === 'invoice'}
              onChange={() => setMethod('invoice')}
              title={t('payment.invoice')}
              desc={t('payment.invoiceDesc')}
            />
          </div>
          {errors.paymentMethod && (
            <p id="payment-error" className="field__error">
              <CircleAlert aria-hidden="true" />
              <span>{err('paymentMethod')}</span>
            </p>
          )}
          {company && <p className="co-hint">{t('payment.companyNote')}</p>}
        </fieldset>
      </div>

      <div className="co-submit">
        {legal.enabled && consentLabels ? (
          <>
            <Checkbox
              name="consentOffer"
              label={consentLabels.offer}
              defaultChecked={initial.consentOffer}
              error={err('consentOffer')}
            />
            <Checkbox name="consentPd" label={consentLabels.pd} defaultChecked={initial.consentPd} error={err('consentPd')} />
          </>
        ) : (
          <Checkbox name="consent" label={t('consent')} defaultChecked={initial.consent} error={err('consent')} />
        )}
        <SubmitButton size="lg" block pending={pending} pendingText={t('pending')}>
          {t('submit', { price: formatPrice(priceKzt) })}
        </SubmitButton>
        <p className="co-hint">{t('note')}</p>
      </div>
    </form>
  );
}

type ChoiceProps = {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  desc: string;
};

/** Карточка-радиокнопка: нативный input (клавиатура, скринридер) + оформление через :has(). Без иконок. */
function Choice({ name, value, checked, disabled, onChange, title, desc }: ChoiceProps) {
  const id = `${name}-${value}`;
  return (
    <label className="co-choice" htmlFor={id}>
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
      />
      <span id={`${id}-title`} className="co-choice__title">
        {title}
      </span>
      <span id={`${id}-desc`} className="co-choice__desc">
        {desc}
      </span>
      <span className="co-choice__dot" aria-hidden="true" />
    </label>
  );
}
