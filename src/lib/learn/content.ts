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

/**
 * Документ урока для локали: свой, если в нём есть блоки, иначе русский (fallback).
 * Документ проходит zod-схему: неизвестные поля отбрасываются, битый контент → null.
 */
export function pickLessonDoc(content: unknown, locale: Locale): PickedDoc | null {
  const docLocale: Locale = locale !== 'ru' && hasBlocks(rawDoc(content, locale)) ? locale : 'ru';
  const raw = rawDoc(content, docLocale) ?? { v: 1, blocks: [] };
  const parsed = lessonDocSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { doc: parsed.data, locale: docLocale, fallback: docLocale !== locale };
}

/** Есть ли в уроке тест (для пометки в оглавлении) — без полной проверки схемы. */
export function contentHasQuiz(content: unknown, locale: Locale): boolean {
  const own = locale !== 'ru' && hasBlocks(rawDoc(content, locale)) ? rawDoc(content, locale) : rawDoc(content, 'ru');
  if (!hasBlocks(own)) return false;
  return (own as { blocks: Array<{ type?: unknown }> }).blocks.some((b) => b?.type === 'quiz');
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
