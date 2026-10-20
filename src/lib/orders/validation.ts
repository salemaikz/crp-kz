// Проверка формы покупки: телефон РК, БИН с контрольной цифрой, zod-схема полей.
// Без серверных зависимостей — чистые функции (unit-тесты).
import { z } from 'zod';
import { BUYER_TYPES, PAYMENT_METHODS, type BuyerType, type PaymentMethod } from './types';

/**
 * Телефон Казахстана → «+7 7XX XXX XX XX» или null.
 * Принимает +7…, 8…, 7… и 10 цифр без кода страны; номера РК начинаются с 7 после +7.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 32 || !/^\+?[\d\s()\-.]+$/.test(s)) return null;
  let d = s.replace(/\D/g, '');
  if (d.length === 11) {
    if (s.startsWith('+') && !d.startsWith('7')) return null;
    if (!d.startsWith('7') && !d.startsWith('8')) return null;
    d = `7${d.slice(1)}`;
  } else if (d.length === 10) {
    d = `7${d}`;
  } else {
    return null;
  }
  if (d[1] !== '7') return null;
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
}

const W1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const W2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

/** БИН/ИИН: 12 цифр и контрольная цифра по официальному алгоритму (веса 1–11, затем 3–11,1,2). */
export function isValidBin(bin: string): boolean {
  if (!/^\d{12}$/.test(bin)) return false;
  const d = [...bin].map(Number);
  const sum = (w: number[]) => w.reduce((acc, weight, i) => acc + weight * (d[i] as number), 0) % 11;
  let check = sum(W1);
  if (check === 10) {
    check = sum(W2);
    if (check === 10) return false;
  }
  return check === d[11];
}

export const CHECKOUT_FIELDS = [
  'courseSlug',
  'buyerType',
  'name',
  'email',
  'phone',
  'companyName',
  'companyBin',
  'paymentMethod',
  'consent',
  'consentOffer',
  'consentPd',
] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

/** Коды ошибок по полям: ключи сообщений checkout.form.errors.<поле>.<код>. */
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

/** Что вернуть в форму после ошибки (без согласия — его отмечают заново осознанно). */
export type CheckoutValues = {
  buyerType: BuyerType;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  companyBin: string;
  paymentMethod: PaymentMethod;
  /** Одна галочка (LEGAL выключен). */
  consent: boolean;
  /** Две галочки (LEGAL включён, D-035): оферта и обработка ПДн. */
  consentOffer: boolean;
  consentPd: boolean;
};

/** Проверенные данные заказа. Сумма и курс берутся из БД, не из формы. */
export type CheckoutInput = {
  courseSlug: string;
  buyerType: BuyerType;
  name: string;
  email: string;
  phone: string;
  companyName: string | null;
  companyBin: string | null;
  paymentMethod: PaymentMethod;
};

export type CheckoutParseResult =
  | { ok: true; data: CheckoutInput; values: CheckoutValues }
  | { ok: false; errors: CheckoutErrors; values: CheckoutValues };

const invalid = () => ({ message: 'invalid' });

const baseShape = {
  courseSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'invalid'),
  buyerType: z.enum(BUYER_TYPES, { errorMap: invalid }),
  name: z.string().trim().min(1, 'required').min(2, 'too_short').max(100, 'too_long'),
  email: z.string().trim().toLowerCase().min(1, 'required').max(254, 'too_long').email('invalid'),
  phone: z
    .string()
    .trim()
    .min(1, 'required')
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid' });
        return z.NEVER;
      }
      return phone;
    }),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: invalid }),
};

const required = () => z.literal('on', { errorMap: () => ({ message: 'required' }) });
/** До D-035: одна галочка. */
const legacySchema = z.object({ ...baseShape, consent: required() });
/** LEGAL включён: оферта и ПДн принимаются отдельно. */
const legalSchema = z.object({ ...baseShape, consentOffer: required(), consentPd: required() });

const companyNameSchema = z.string().trim().min(1, 'required').min(2, 'too_short').max(200, 'too_long');

function str(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Значения для повторного показа формы: только строки известной длины. */
function echo(raw: Record<string, unknown>): CheckoutValues {
  return {
    buyerType: raw.buyerType === 'company' ? 'company' : 'person',
    name: str(raw.name, 100),
    email: str(raw.email, 254),
    phone: str(raw.phone, 32),
    companyName: str(raw.companyName, 200),
    companyBin: str(raw.companyBin, 20),
    paymentMethod: raw.paymentMethod === 'invoice' ? 'invoice' : 'kaspi',
    consent: raw.consent === 'on',
    consentOffer: raw.consentOffer === 'on',
    consentPd: raw.consentPd === 'on',
  };
}

/**
 * Разбор формы покупки. Юрлицо: название, БИН (12 цифр + контрольная) и только оплата по счёту.
 * Физлицо: Kaspi или счёт; поля компании игнорируются.
 * legal (LEGAL активен) — две галочки consentOffer и consentPd вместо одной consent.
 */
export function parseCheckout(raw: Record<string, unknown>, opts: { legal: boolean }): CheckoutParseResult {
  const values = echo(raw);
  const errors: CheckoutErrors = {};
  const put = (field: CheckoutField, code: string) => {
    if (!errors[field]) errors[field] = code;
  };

  const base = (opts.legal ? legalSchema : legacySchema).safeParse({
    courseSlug: str(raw.courseSlug, 100),
    buyerType: str(raw.buyerType, 20),
    name: str(raw.name, 300),
    email: str(raw.email, 300),
    phone: str(raw.phone, 64),
    paymentMethod: str(raw.paymentMethod, 20),
    ...(opts.legal
      ? { consentOffer: str(raw.consentOffer, 10), consentPd: str(raw.consentPd, 10) }
      : { consent: str(raw.consent, 10) }),
  });
  if (!base.success) {
    for (const issue of base.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && (CHECKOUT_FIELDS as readonly string[]).includes(field)) {
        put(field as CheckoutField, issue.message);
      }
    }
  }

  let companyName: string | null = null;
  let companyBin: string | null = null;
  if (values.buyerType === 'company') {
    const name = companyNameSchema.safeParse(str(raw.companyName, 300));
    if (name.success) companyName = name.data;
    else put('companyName', name.error.issues[0]?.message ?? 'invalid');

    const bin = str(raw.companyBin, 40).replace(/[\s-]/g, '');
    if (!bin) put('companyBin', 'required');
    else if (!/^\d{12}$/.test(bin)) put('companyBin', 'format');
    else if (!isValidBin(bin)) put('companyBin', 'checksum');
    else companyBin = bin;

    if (raw.paymentMethod !== 'invoice') put('paymentMethod', 'company_invoice_only');
  }

  if (!base.success || Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    values,
    data: {
      courseSlug: base.data.courseSlug,
      buyerType: base.data.buyerType,
      name: base.data.name,
      email: base.data.email,
      phone: base.data.phone,
      companyName,
      companyBin,
      paymentMethod: base.data.paymentMethod,
    },
  };
}
