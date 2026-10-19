// Данные для тестов PDF сертификата: владелец с kz-ФИО, посторонний, опубликованный курс и черновик.
import { enroll, revokeEnrollment } from '../../../src/lib/access';
import type { TestDb } from '../../../src/lib/db/testing';

export const OWNER_EMAIL = 'owner-secret@crp-pdf.invalid';
export const OWNER_NAME = 'Әлия Құрманғалиқызы';
export const PDF_COURSE_SLUG = 'pdf-course';
export const PDF_NUMBER = 'CRP-2026-PDFKZ2';
export const RU_NUMBER = 'CRP-2026-PDFRU3';
/** Имя целиком из символов вне шрифта: после очистки пусто. */
export const EMOJI_NAME = '\u{1F600}\u{1F680}';
export const EMOJI_NUMBER = 'CRP-2026-PDFEM6';
/** Имя с частично неотображаемыми буквами: «Анна» и два иероглифа. */
export const PARTIAL_NAME = 'Анна \u4e2d\u6587';
export const PARTIAL_NUMBER = 'CRP-2026-PDFPA7';
/** Обычное имя, но название курса целиком из символов вне шрифта. */
export const EMPTY_COURSE_SLUG = 'pdf-empty-title';
export const EMPTY_COURSE_NUMBER = 'CRP-2026-PDFET9';
/** Имя из 200 заглавных Ж: не влезает по высоте даже на жёстком пределе кегля. */
export const LONG_NAME = '\u0416'.repeat(200);
export const LONG_NUMBER = 'CRP-2026-PDFLN8';

export async function seedPdf(db: TestDb): Promise<void> {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('pdf-owner', ${OWNER_EMAIL}, ${OWNER_NAME}, 1),
    ('pdf-other', 'other-secret@crp-pdf.invalid', 'Посторонний Человек', 1),
    ('pdf-ru', 'ru-secret@crp-pdf.invalid', 'Марат Нурланов', 1),
    ('pdf-emoji', 'emoji-secret@crp-pdf.invalid', ${EMOJI_NAME}, 1),
    ('pdf-partial', 'partial-secret@crp-pdf.invalid', ${PARTIAL_NAME}, 1),
    ('pdf-empty', 'empty-secret@crp-pdf.invalid', 'Марат Нурланов', 1),
    ('pdf-long', 'long-secret@crp-pdf.invalid', ${LONG_NAME}, 1)`;
  await db.sql`INSERT INTO courses (id, slug, title, status, created_at, updated_at) VALUES
    ('pdf-c1', ${PDF_COURSE_SLUG}, ${db.json({ ru: 'Бизнес-разбор', kz: 'Бизнесті талдау: ғылыми-практикалық үлгі' })}, 'published', 1, 1),
    ('pdf-draft', 'pdf-draft', ${db.json({ ru: 'Черновик' })}, 'draft', 1, 1),
    ('pdf-c2', ${EMPTY_COURSE_SLUG}, ${db.json({ ru: '\u{1F600}\u{1F680}' })}, 'published', 1, 1)`;
  await db.sql`INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at) VALUES
    ('pdf-cert-kz', ${PDF_NUMBER}, 'pdf-owner', 'pdf-c1', ${OWNER_NAME}, 'kz', 1760000000000),
    ('pdf-cert-ru', ${RU_NUMBER}, 'pdf-ru', 'pdf-c1', 'Марат Нурланов', 'ru', 1760000000000),
    ('pdf-cert-emoji', ${EMOJI_NUMBER}, 'pdf-emoji', 'pdf-c1', ${EMOJI_NAME}, 'ru', 1760000000000),
    ('pdf-cert-partial', ${PARTIAL_NUMBER}, 'pdf-partial', 'pdf-c1', ${PARTIAL_NAME}, 'ru', 1760000000000),
    ('pdf-cert-long', ${LONG_NUMBER}, 'pdf-long', 'pdf-c1', ${LONG_NAME}, 'ru', 1760000000000),
    ('pdf-cert-empty-title', ${EMPTY_COURSE_NUMBER}, 'pdf-empty', 'pdf-c2', 'Марат Нурланов', 'ru', 1760000000000),
    ('pdf-cert-draft', 'CRP-2026-PDFDR4', 'pdf-owner', 'pdf-draft', ${OWNER_NAME}, 'ru', 1760000000000)`;
  // доступ закрыт: сертификат сохраняется (SPEC §2)
  await enroll({ userId: 'pdf-owner', courseId: 'pdf-c1', source: 'grant' });
  await revokeEnrollment('pdf-owner', 'pdf-c1', null);
}
