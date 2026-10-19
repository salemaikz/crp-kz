// Конструкторы блоков для демо-контента: данные курсов читаются как текст, а не как JSON.
// Только типы из '@/lib/content/types' — модуль не тянет рантайм-зависимостей.
import type {
  Block,
  CalloutBlock,
  HeadingBlock,
  L10n,
  LessonDoc,
  QuizBlock,
  QuizQuestion,
  SeedLesson,
  SeedModule,
  TextBlock,
  VideoBlock,
} from '@/lib/content/types';

const NBSP = ' ';

/** Типографика: неразрывные пробелы в числах («99 000 ₸») и перед тире. */
export function typo(s: string): string {
  return s
    .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
    .replace(/ ₸/g, `${NBSP}₸`)
    .replace(/ —/g, `${NBSP}—`);
}

/** Локализованная строка: ru обязателен, kz — перевод (если есть). */
export const L = (ru: string, kz?: string): L10n => (kz === undefined ? { ru: typo(ru) } : { ru: typo(ru), kz: typo(kz) });

export const h2 = (id: string, text: string): HeadingBlock => ({ id, type: 'heading', level: 2, text: typo(text) });

export const md = (id: string, markdown: string): TextBlock => ({ id, type: 'text', markdown: typo(markdown.trim()) });

export const note = (id: string, tone: CalloutBlock['tone'], text: string): CalloutBlock => ({
  id,
  type: 'callout',
  tone,
  text: typo(text),
});

/** Видео-заглушка: реальный ролик подключит ЦРП. */
export const video = (id: string, caption: string): VideoBlock => ({
  id,
  type: 'video',
  provider: 'placeholder',
  caption: typo(caption),
});

/**
 * Вопрос теста. correct — индекс (один ответ) или массив индексов (множественный выбор).
 * explain обязателен: пояснение показывается после попытки.
 */
export function q(id: string, text: string, options: string[], correct: number | number[], explain: string): QuizQuestion {
  return {
    id,
    text: typo(text),
    options: options.map(typo),
    correct: Array.isArray(correct) ? correct : [correct],
    multiple: Array.isArray(correct),
    explain: typo(explain),
  };
}

export const quiz = (id: string, passScore: number, questions: QuizQuestion[]): QuizBlock => ({
  id,
  type: 'quiz',
  passScore,
  questions,
});

const doc = (blocks: Block[]): LessonDoc => ({ v: 1, blocks });

/** Урок: блоки на русском обязательны, на казахском — по возможности. */
export function lesson(slug: string, title: L10n, durationMin: number, ru: Block[], kz?: Block[]): SeedLesson {
  return { slug, title, durationMin, content: kz ? { ru: doc(ru), kz: doc(kz) } : { ru: doc(ru) } };
}

export const mod = (title: L10n, lessons: SeedLesson[]): SeedModule => ({ title, lessons });

/** Суммарная длительность курса по урокам. */
export const totalMin = (modules: readonly SeedModule[]): number =>
  modules.reduce((sum, m) => sum + m.lessons.reduce((s, l) => s + l.durationMin, 0), 0);
