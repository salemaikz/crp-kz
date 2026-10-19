// Типы PDF сертификата. Только данные: ни email, ни id пользователя в PDF не передаются (тип это исключает).
import type { Locale } from '../../content/types';

/**
 * Версия макета: входит в ETag, поэтому смена вёрстки сбрасывает кэш браузеров.
 * 1 — первый выпуск; поднимать при любой смене вёрстки (до этого PDF нигде не отдавались).
 */
export const CERT_PDF_TEMPLATE_VERSION = 1;

/** Подписи листа: learn.certificate.sheet.* на языке сертификата. */
export type CertificatePdfLabels = {
  title: string;
  certifies: string;
  completed: string;
  issued: string;
  number: string;
  org: string;
  place: string;
  qrTitle: string;
  /** Свойство Title у PDF: «Сертификат {number}», уже подставленное. */
  metaTitle: string;
};

export type CertificatePdfInput = {
  /** CERT_NUMBER_RE: ASCII, безопасен в имени файла. */
  number: string;
  holderName: string;
  /** Название курса, уже выбранное по языку сертификата. */
  courseTitle: string;
  issuedAt: number;
  /** Язык сертификата = язык прохождения курса. */
  locale: Locale;
  verifyUrl: string;
  /** Дата выдачи, отформатированная по локали сертификата. */
  issuedDate: string;
  /** Адрес страницы проверки без схемы: подпись под QR. */
  verifyHost: string;
  labels: CertificatePdfLabels;
};

/** Адрес сайта для QR не настроен (вне демо нужен https-адрес в NEXT_PUBLIC_SITE_URL). */
export class PdfConfigError extends Error {
  constructor() {
    super('pdf_site_url_not_configured');
    this.name = 'PdfConfigError';
  }
}
