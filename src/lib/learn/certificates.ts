// Сертификаты: выдача после 100 % (идемпотентно), номер CRP-<год>-<6 символов>, публичная проверка.
import { randomInt } from 'node:crypto';
import type { Locale } from '../content/types';
import { getDb, isUniqueViolation, newId, now, type Sql } from '../db';
import { jsonParam } from '../db/core';
import { LearnError } from './errors';
import { loadCourseAccess } from './gate';
import type { CertificateRow, PublicCertificate } from './types';

/** Алфавит без похожих знаков (нет I, O, 0, 1): номер удобно читать и диктовать. */
export const CERT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CERT_NUMBER_RE = /^CRP-\d{4}-[A-HJ-NP-Z2-9]{6}$/;
const MAX_NUMBER_ATTEMPTS = 8;

/** Номер сертификата: CRP-<год>-<6 символов алфавита>. */
export function generateCertificateNumber(issuedAt: number = now(), pick: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CERT_ALPHABET[pick(CERT_ALPHABET.length)];
  return `CRP-${new Date(issuedAt).getUTCFullYear()}-${code}`;
}

/** Номер из строки поиска: пробелы и регистр не важны; не по формату → null. */
export function normalizeCertificateNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const n = input.trim().toUpperCase();
  return CERT_NUMBER_RE.test(n) ? n : null;
}

export async function getCertificate(userId: string, courseId: string, sql?: Sql): Promise<CertificateRow | null> {
  const s = sql ?? (await getDb()).sql;
  const [row] = await s<CertificateRow>`
    SELECT id, number, user_id, course_id, holder_name, locale, issued_at
    FROM certificates WHERE user_id = ${userId} AND course_id = ${courseId}`;
  return row ?? null;
}

export type IssueInput = {
  user: { id: string; name: string };
  courseId: string;
  locale: Locale;
  /** Только для тестов: подмена генератора номера (проверка повтора при коллизии). */
  generateNumber?: () => string;
};

/**
 * Выдать сертификат. Идемпотентно: UNIQUE(user, course) — повторный вызов возвращает уже выданный.
 * Новый сертификат — только при действующем зачислении и пройденных 100 % опубликованных уроков.
 * Коллизия номера (UNIQUE(number)) → новая попытка с другим номером.
 */
export async function issueCertificate(input: IssueInput): Promise<{ certificate: CertificateRow; created: boolean }> {
  const existing = await getCertificate(input.user.id, input.courseId);
  if (existing) return { certificate: existing, created: false };

  const access = await loadCourseAccess(input.user.id, { id: input.courseId });
  if (access.status === 'not_found') throw new LearnError('not_found');
  if (access.status === 'denied') throw new LearnError('forbidden', { reason: access.reason });
  if (!access.progress.complete) throw new LearnError('not_complete');

  const db = await getDb();
  const holderName = input.user.name.trim() || input.user.name;
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const issuedAt = now();
    const number = input.generateNumber ? input.generateNumber() : generateCertificateNumber(issuedAt);
    let inserted: CertificateRow | undefined;
    try {
      // ON CONFLICT DO NOTHING без цели: и гонка по (user, course), и коллизия номера не роняют запрос
      [inserted] = await db.sql<CertificateRow>`
        INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at)
        VALUES (${newId()}, ${number}, ${input.user.id}, ${input.courseId}, ${holderName}, ${input.locale}, ${issuedAt})
        ON CONFLICT DO NOTHING
        RETURNING id, number, user_id, course_id, holder_name, locale, issued_at`;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      continue; // редкая гонка на уровне драйвера — пробуем другой номер
    }
    if (inserted) {
      await db.sql`
        INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
        VALUES (${newId()}, ${input.user.id}, 'certificate.issue', 'certificate', ${inserted.id},
                ${jsonParam({ courseId: input.courseId, number: inserted.number })}, ${issuedAt})`;
      return { certificate: inserted, created: true };
    }
    // ничего не вставили: либо параллельный вызов уже выдал сертификат, либо занят номер
    const raced = await getCertificate(input.user.id, input.courseId);
    if (raced) return { certificate: raced, created: false };
  }
  throw new Error('certificate number generation failed');
}

/** Публичная проверка по номеру: ФИО, курс, дата. Email и id пользователя не читаются. */
export async function findCertificateByNumber(input: unknown): Promise<PublicCertificate | null> {
  const number = normalizeCertificateNumber(input);
  if (!number) return null;
  const db = await getDb();
  const [row] = await db.sql<PublicCertificate>`
    SELECT ce.number, ce.holder_name, ce.locale, ce.issued_at, c.title AS course_title
    FROM certificates ce JOIN courses c ON c.id = ce.course_id
    WHERE ce.number = ${number}`;
  return row ?? null;
}
