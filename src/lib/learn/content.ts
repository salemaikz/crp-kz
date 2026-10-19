// Контент урока для слушателя: выбор локали с запасным ru и payload для клиента без ответов теста.
import { lessonDocSchema, toPublicBlocks } from '../content/blocks';
import type { LessonDoc, Locale, PublicBlock, QuizBlock } from '../content/types';

export type PickedDoc = {
  doc: LessonDoc;
  /** Локаль документа, который реально показываем (может быть ru при запросе kz). */
  locale: Locale;
  /** Перевода нет — показываем русский документ. */
  fallback: boolean;
};

function rawDoc(content: unknown, locale: string): unknown {
  if (typeof content !== 'object' || content === null) return undefined;
  return (content as Record<string, unknown>)[locale];
}

function hasBlocks(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const blocks = (raw as { blocks?: unknown }).blocks;
  return Array.isArray(blocks) && blocks.length > 0;
}

/** Id блоков-тестов «сырого» документа (без полной проверки схемы). */
function rawQuizIds(raw: unknown): string[] {
  if (!hasBlocks(raw)) return [];
  return (raw as { blocks: Array<{ type?: unknown; id?: unknown }> }).blocks
    .filter((b) => b?.type === 'quiz' && typeof b.id === 'string')
    .map((b) => b.id as string);
}

/**
 * Можно ли показывать перевод вместо ru: в нём есть блоки и все тесты русского документа
 * (по id блока). Иначе слушатель в этой локали увидел бы урок без обязательного теста и
 * засчитал бы его без проверки — поэтому такой перевод не показываем, берём ru.
 */
function translationUsable(content: unknown, locale: Locale): boolean {
  if (locale === 'ru') return false;
  const own = rawDoc(content, locale);
  if (!hasBlocks(own)) return false;
  const ids = new Set(rawQuizIds(own));
  return rawQuizIds(rawDoc(content, 'ru')).every((id) => ids.has(id));
}

/**
 * Документ урока для локали — единственная точка выбора (страница, тест, «Урок пройден»).
 * Свой документ, если в нём есть блоки и все тесты русского (translationUsable) и он проходит
 * схему; иначе русский (fallback). Тесты, обязательные для завершения, — тесты именно этого
 * документа, поэтому выбор локали не позволяет обойти тест.
 * Документ проходит zod-схему: неизвестные поля отбрасываются, битый контент → null.
 */
export function pickLessonDoc(content: unknown, locale: Locale): PickedDoc | null {
  if (translationUsable(content, locale)) {
    const own = lessonDocSchema.safeParse(rawDoc(content, locale));
    if (own.success) return { doc: own.data, locale, fallback: false };
  }
  const raw = rawDoc(content, 'ru') ?? { v: 1, blocks: [] };
  const parsed = lessonDocSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { doc: parsed.data, locale: 'ru', fallback: locale !== 'ru' };
}

/** Есть ли в уроке тест (для пометки в оглавлении) — без полной проверки схемы, тот же выбор документа. */
export function contentHasQuiz(content: unknown, locale: Locale): boolean {
  const docLocale: Locale = translationUsable(content, locale) ? locale : 'ru';
  return rawQuizIds(rawDoc(content, docLocale)).length > 0;
}

export function quizBlocksOf(doc: LessonDoc): QuizBlock[] {
  return doc.blocks.filter((b): b is QuizBlock => b.type === 'quiz');
}

/**
 * Ключ попытки в quiz_attempts.block_id. Для русского документа — id блока как есть
 * (так пишет и сид), для остальных — с префиксом локали: тест в kz-документе
 * не засчитывается как сданный «по тому же id» в ru-документе и наоборот.
 */
export function attemptKey(docLocale: Locale, blockId: string): string {
  return docLocale === 'ru' ? blockId : `${docLocale}:${blockId}`;
}

export type PublicLesson = { locale: Locale; fallback: boolean; blocks: PublicBlock[] };

/**
 * Единственный путь контента урока на клиент: блоки без правильных ответов и пояснений.
 * correct и explain уходят только в ответе на попытку (scoreQuiz).
 */
export function toPublicLesson(picked: PickedDoc): PublicLesson {
  return { locale: picked.locale, fallback: picked.fallback, blocks: toPublicBlocks(picked.doc.blocks) };
}
