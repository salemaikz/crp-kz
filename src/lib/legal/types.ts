// Типы юридических документов и согласий (D-035). Реестр версий — registry.ts,
// загрузка текстов, запись согласий и страницы — задача 1B.

export const LEGAL_DOC_KINDS = ['offer', 'privacy', 'pd_consent', 'refund'] as const;
export type LegalDocKind = (typeof LEGAL_DOC_KINDS)[number];

/** Сегмент URL и папка content/legal: pd_consent → pd-consent. */
export const LEGAL_DOC_SLUG: Record<LegalDocKind, string> = {
  offer: 'offer',
  privacy: 'privacy',
  pd_consent: 'pd-consent',
  refund: 'refund',
};

/** Вид документа по сегменту URL; всё остальное (регистр, «../», snake_case) — null. */
export function docKindFromSlug(slug: string): LegalDocKind | null {
  return LEGAL_DOC_KINDS.find((k) => LEGAL_DOC_SLUG[k] === slug) ?? null;
}

export const CONSENT_KINDS = ['offer', 'pd_processing', 'cross_border'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Какой документ принимается согласием. cross_border — текст появится вместе с провайдером. */
export const CONSENT_DOC: Record<ConsentKind, LegalDocKind | null> = {
  offer: 'offer',
  pd_processing: 'pd_consent',
  cross_border: null,
};

export type ConsentContext = 'register' | 'checkout';

/** Согласия, которые даёт покупатель при оформлении заказа и при регистрации. */
export const CHECKOUT_CONSENTS = ['offer', 'pd_processing'] as const satisfies readonly ConsentKind[];
export const REGISTER_CONSENTS = ['pd_processing'] as const satisfies readonly ConsentKind[];

/** Версия до #17: так помечены согласия без текста (легаси-режим при неактивном LEGAL). */
export const LEGACY_CONSENT_VERSION = '2026-10-19';

export type LegalVersion = {
  kind: LegalDocKind;
  /** 'YYYY-MM-DD' или 'YYYY-MM-DD-N' — дата редакции. */
  version: string;
  /** 'YYYY-MM-DD', с какого дня действует. */
  effectiveFrom: string;
  /** true — заглушка, не утверждена юристом. */
  draft: boolean;
  /** kz: null — казахской версии нет, показываем ru. */
  sha256: { ru: string; kz: string | null };
};

export type LegalText = {
  kind: LegalDocKind;
  version: string;
  draft: boolean;
  effectiveFrom: string;
  /** Язык показанного текста (после запасного ru). */
  locale: 'ru' | 'kz';
  /** Просили kz, показали ru. */
  fallback: boolean;
  title: string;
  /** Markdown без строки заголовка. */
  body: string;
  /** Нормализованный исходник целиком (то, что хэшируется). */
  source: string;
  sha256: string;
};
