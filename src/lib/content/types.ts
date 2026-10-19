// Общие типы контента курсов. Нормативно: docs/lms/BUILD.md §3.
// zod-схемы в blocks.ts обязаны соответствовать этим типам.

export const LOCALES = ['ru', 'kz'] as const;
export type Locale = (typeof LOCALES)[number];

/** Локализованная строка: ru обязателен, kz — по возможности. */
export type L10n = { ru: string; kz?: string };

export type HeadingBlock = { id: string; type: 'heading'; level: 2 | 3; text: string };
export type TextBlock = { id: string; type: 'text'; markdown: string };
export type VideoBlock = {
  id: string;
  type: 'video';
  provider: 'youtube' | 'placeholder';
  youtubeId?: string;
  caption?: string;
};
export type CalloutBlock = { id: string; type: 'callout'; tone: 'info' | 'warn' | 'success'; text: string };
export type DividerBlock = { id: string; type: 'divider' };
export type QuizQuestion = {
  id: string;
  text: string;
  options: string[]; // 2..8
  correct: number[]; // индексы правильных, минимум один
  multiple: boolean; // false — один ответ
  explain?: string; // пояснение, показывается только после попытки
};
export type QuizBlock = { id: string; type: 'quiz'; passScore: number; questions: QuizQuestion[] };

export type Block = HeadingBlock | TextBlock | VideoBlock | CalloutBlock | DividerBlock | QuizBlock;

/** Контент одной локали урока. */
export type LessonDoc = { v: 1; blocks: Block[] };
/** Контент урока по локалям, как в колонке lessons.content. */
export type LessonContent = { ru: LessonDoc; kz?: LessonDoc };

/** Квиз без правильных ответов и пояснений — только это уходит на клиент до сдачи. */
export type PublicQuizQuestion = Omit<QuizQuestion, 'correct' | 'explain'>;
export type PublicQuizBlock = Omit<QuizBlock, 'questions'> & { questions: PublicQuizQuestion[] };
export type PublicBlock = Exclude<Block, QuizBlock> | PublicQuizBlock;

// ---------- Демо-контент для сида (src/lib/db/seed/content/*.ts) ----------

export interface SeedLesson {
  slug: string; // латиница, уникален в курсе
  title: L10n;
  durationMin: number;
  content: LessonContent;
}

export interface SeedModule {
  title: L10n;
  lessons: SeedLesson[];
}

export interface SeedCourse {
  id: string; // фиксированный UUID — сид детерминированный
  slug: string;
  title: L10n;
  summary: L10n; // 1–2 предложения для карточки
  description: L10n; // markdown для страницы курса
  level: 'start' | 'base' | 'pro';
  durationMin: number;
  visibility: 'public' | 'internal' | 'private';
  ownerOrg: 'crp' | null; // для internal — организация ЦРП
  priceKzt: number | null; // null или 0 — бесплатно
  accessDays: number | null; // null — бессрочно
  sequential: boolean;
  modules: SeedModule[];
}
