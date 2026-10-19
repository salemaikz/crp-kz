// Согласия: подготовка текстов вне транзакции, проверка токена версий, запись и чтение.
// Регистрация и заказ вызовут эти функции в задаче 3A; до неё они готовы, но не подключены.
// Флаг LEGAL — только через isFeatureActive (D-025); черновики допустимы лишь в демо.
import { getDb, newId, type Sql } from '../db';
import { isDemo } from '../env';
import { isFeatureActive } from '../features';
import type { Locale } from '../content/types';
import { currentVersion, versionsToken } from './registry';
import { loadLegalText } from './texts';
import {
  CONSENT_DOC,
  LEGACY_CONSENT_VERSION,
  type ConsentContext,
  type ConsentKind,
  type LegalText,
} from './types';

/** LEGAL работает: флаг включён и (в проде) все документы утверждены. */
export function isLegalEnabled(): boolean {
  return isFeatureActive('LEGAL');
}

/** Черновики показываются и принимаются только в демо. */
export function legalAllowDrafts(): boolean {
  return isDemo();
}

export type PreparedConsent = {
  kind: ConsentKind;
  version: string;
  locale: Locale | null;
  /** null — легаси-режим (LEGAL неактивен): версия-константа без текста. */
  text: LegalText | null;
};

/** Согласие фиксирует язык фактически показанного текста (при запасном ru — 'ru', а не запрошенный). */
export function toPrepared(kind: ConsentKind, version: string, text: LegalText): PreparedConsent {
  return { kind, version, locale: text.locale, text };
}

/**
 * Подготовка вне транзакции (чтение файлов). LEGAL неактивен — легаси-версия без текста.
 * Вид без документа (cross_border) или без действующей версии — Error: принять нечего.
 */
export async function prepareConsents(kinds: readonly ConsentKind[], locale: Locale): Promise<PreparedConsent[]> {
  if (!isLegalEnabled()) {
    return kinds.map((kind) => ({ kind, version: LEGACY_CONSENT_VERSION, locale: null, text: null }));
  }
  const allowDrafts = legalAllowDrafts();
  const out: PreparedConsent[] = [];
  for (const kind of kinds) {
    const doc = CONSENT_DOC[kind];
    const version = doc ? currentVersion(doc, { allowDrafts }) : null;
    if (!doc || !version) throw new Error(`legal: для согласия «${kind}» нет действующей версии документа`);
    out.push(toPrepared(kind, version.version, await loadLegalText(version, locale)));
  }
  return out;
}

/**
 * Токен версий из формы совпадает с текущим. Сервер текст по токену не выбирает, только
 * сравнивает. LEGAL неактивен — всегда true (токена в форме нет).
 */
export function consentTokenFresh(token: unknown, kinds: readonly ConsentKind[]): boolean {
  if (!isLegalEnabled()) return true;
  if (typeof token !== 'string') return false;
  const expected = versionsToken(kinds, { allowDrafts: legalAllowDrafts() });
  // у какого-то вида нет действующей версии: принять нечего, форма получит legal_changed, а не 500
  if (expected.includes('@none')) return false;
  return token === expected;
}

/**
 * Запись внутри транзакции вызывающего (регистрация, заказ): копия текста в legal_texts по хэшу
 * (повтор безопасен), затем строки consents. userId берётся вызывающим из сессии или из
 * нового аккаунта той же транзакции, не из формы.
 */
export async function insertConsents(
  sql: Sql,
  input: { userId: string; orderId: string | null; context: ConsentContext; at: number; consents: PreparedConsent[] },
): Promise<void> {
  for (const c of input.consents) {
    if (c.text) {
      await sql`
        INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
        VALUES (${c.text.sha256}, ${c.text.kind}, ${c.text.version}, ${c.text.locale}, ${c.text.title},
                ${c.text.source}, ${c.text.draft}, ${input.at})
        ON CONFLICT (sha256) DO NOTHING`;
    }
    await sql`
      INSERT INTO consents (id, user_id, order_id, kind, version, locale, context, text_sha256, created_at)
      VALUES (${newId()}, ${input.userId}, ${input.orderId}, ${c.kind}, ${c.version}, ${c.locale},
              ${input.context}, ${c.text?.sha256 ?? null}, ${input.at})`;
  }
}

export type ConsentView = {
  kind: ConsentKind;
  version: string;
  locale: string | null;
  context: string | null;
  createdAt: number;
  orderNumber: string | null;
  textSha256: string | null;
  withdrawnAt: number | null;
};

/** Согласия пользователя для карточки в админке. Вызывать только после requireAdmin. */
export async function listUserConsents(userId: string): Promise<ConsentView[]> {
  const { sql } = await getDb();
  return sql<ConsentView>`
    SELECT c.kind, c.version, c.locale, c.context, c.created_at, o.number AS order_number,
           c.text_sha256, c.withdrawn_at
    FROM consents c
    LEFT JOIN orders o ON o.id = c.order_id
    WHERE c.user_id = ${userId}
    ORDER BY c.created_at DESC, c.id`;
}
