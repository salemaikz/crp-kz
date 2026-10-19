// Данные для PDF сертификата: владелец (по сессии), опубликованный курс, подписи на языке сертификата.
import { createTranslator } from 'next-intl';
import kz from '../../../../messages/kz/learn.json';
import ru from '../../../../messages/ru/learn.json';
import { t as loc } from '../../content/l10n';
import type { Locale } from '../../content/types';
import { siteUrl, siteUrlConfigured, type Env } from '../../env';
import { formatDate } from '../../format';
import { getCertificate } from '../certificates';
import { getCourse } from '../data';
import { certificateVerifyUrl } from '../qr';
import { PdfConfigError, type CertificatePdfInput, type CertificatePdfLabels } from './types';

const MESSAGES = { ru, kz } as const;
/** Для Intl и правил ICU казахский — kk (D-002). */
const ICU_LOCALE: Record<Locale, string> = { ru: 'ru', kz: 'kk' };

/**
 * Адрес сайта для QR. Берётся из env (siteUrl), а не из заголовка Host. Вне демо без https-адреса —
 * PdfConfigError: иначе QR вёл бы на localhost. Маршрут отвечает на это 503.
 */
export function publicSiteUrl(env: Env = process.env): string {
  if (!siteUrlConfigured(env)) throw new PdfConfigError();
  return siteUrl(env);
}

function sheetLabels(locale: Locale, number: string): CertificatePdfLabels {
  const t = createTranslator({
    locale: ICU_LOCALE[locale],
    messages: MESSAGES[locale],
    namespace: 'certificate.sheet',
  } as never) as unknown as (key: string, values?: Record<string, string>) => string;
  return {
    title: t('title'),
    certifies: t('certifies'),
    completed: t('completed'),
    issued: t('issued'),
    number: t('number'),
    org: t('org'),
    place: t('place'),
    qrTitle: t('qrTitle'),
    metaTitle: t('metaTitle', { number }),
  };
}

/**
 * Сертификат пользователя по курсу для PDF. null — нет опубликованного курса или сертификата
 * (вызывающий отвечает одинаковым 404, а при навигации, Accept: text/html, — одинаковым 303 на /{locale}/learn). Доступ к курсу не проверяется: сертификат сохраняется
 * после окончания доступа (SPEC §2). Email и id пользователя в результат не попадают.
 */
export async function loadCertificatePdfInput(userId: string, slug: string): Promise<CertificatePdfInput | null> {
  const course = await getCourse({ slug });
  if (!course || course.status !== 'published') return null;
  const cert = await getCertificate(userId, course.id);
  if (!cert) return null;

  const site = publicSiteUrl();
  return {
    number: cert.number,
    holderName: cert.holderName,
    courseTitle: loc(course.title, cert.locale),
    issuedAt: cert.issuedAt,
    locale: cert.locale,
    verifyUrl: certificateVerifyUrl(site, cert.locale, cert.number),
    issuedDate: formatDate(cert.issuedAt, cert.locale),
    verifyHost: `${new URL(site).host}/${cert.locale}/cert`,
    labels: sheetLabels(cert.locale, cert.number),
  };
}
