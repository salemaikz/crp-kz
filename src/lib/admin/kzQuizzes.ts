// Тесты казахской версии урока против русской (D-020, D-021): в непустой kz-версии — тот же набор
// id блоков-тестов, что в ru. Чистые функции без серверных зависимостей: их используют и проверка
// при сохранении (lessons.ts), и кнопки редактора «Добавить недостающие» / «Убрать лишние».
import type { Block, QuizBlock } from '../content/types';

export type KzQuizDiff = {
  /** Тесты русской версии, которых нет в казахской (по id блока). */
  missing: string[];
  /** Тесты казахской версии, которых нет в русской — например, тест удалили в ru. */
  extra: string[];
};

const quizzes = (blocks: readonly Block[]): QuizBlock[] => blocks.filter((b): b is QuizBlock => b.type === 'quiz');

/** Расхождение тестов. Пустая казахская версия ни с чем не расходится: слушатель увидит русскую. */
export function kzQuizDiff(ru: readonly Block[], kz: readonly Block[]): KzQuizDiff {
  if (kz.length === 0) return { missing: [], extra: [] };
  const ruIds = new Set(quizzes(ru).map((b) => b.id));
  const kzIds = new Set(quizzes(kz).map((b) => b.id));
  return {
    missing: [...ruIds].filter((id) => !kzIds.has(id)),
    extra: [...kzIds].filter((id) => !ruIds.has(id)),
  };
}

export function kzQuizzesInSync(ru: readonly Block[], kz: readonly Block[]): boolean {
  const d = kzQuizDiff(ru, kz);
  return d.missing.length === 0 && d.extra.length === 0;
}

/**
 * Дописать в конец казахской версии копии тестов русской, которых в ней нет: те же id (попытка
 * засчитывается независимо от языка), русский текст — заготовка для перевода. Остальные блоки
 * казахской версии не меняются.
 */
export function addMissingKzQuizzes(ru: readonly Block[], kz: readonly Block[]): Block[] {
  const have = new Set(kz.map((b) => b.id));
  const add = quizzes(ru).filter((b) => !have.has(b.id));
  return [...kz, ...(JSON.parse(JSON.stringify(add)) as Block[])];
}

/** Убрать из казахской версии тесты, которых нет в русской. Остальные блоки не меняются. */
export function removeExtraKzQuizzes(ru: readonly Block[], kz: readonly Block[]): Block[] {
  const ruIds = new Set(quizzes(ru).map((b) => b.id));
  return kz.filter((b) => b.type !== 'quiz' || ruIds.has(b.id));
}
