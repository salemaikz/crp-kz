// zod-схемы контента урока. Обязаны совпадать с типами в ./types.ts (проверка типов внизу файла).
// Нормативно: docs/lms/BUILD.md §3.
import { z } from 'zod';
import type {
  Block,
  CalloutBlock,
  DividerBlock,
  HeadingBlock,
  L10n,
  LessonContent,
  LessonDoc,
  PublicBlock,
  QuizBlock,
  QuizQuestion,
  TextBlock,
  VideoBlock,
} from './types';

/** Пределы размеров контента. */
export const LIMITS = {
  idLength: 64,
  headingText: 300,
  markdown: 20_000,
  caption: 500,
  calloutText: 2_000,
  questionText: 1_000,
  optionText: 500,
  explain: 2_000,
  optionsMin: 2,
  optionsMax: 8,
  questionsMax: 50,
  blocksMax: 200,
  /** Сериализованный документ одной локали, байт. */
  docBytes: 512_000,
} as const;

const blockId = z.string().min(1).max(LIMITS.idLength);

export const headingBlockSchema = z.object({
  id: blockId,
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3)]),
  text: z.string().min(1).max(LIMITS.headingText),
});

export const textBlockSchema = z.object({
  id: blockId,
  type: z.literal('text'),
  markdown: z.string().max(LIMITS.markdown),
});

export const videoBlockSchema = z.object({
  id: blockId,
  type: z.literal('video'),
  provider: z.enum(['youtube', 'placeholder']),
  youtubeId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .optional(),
  caption: z.string().max(LIMITS.caption).optional(),
});

export const calloutBlockSchema = z.object({
  id: blockId,
  type: z.literal('callout'),
  tone: z.enum(['info', 'warn', 'success']),
  text: z.string().min(1).max(LIMITS.calloutText),
});

export const dividerBlockSchema = z.object({
  id: blockId,
  type: z.literal('divider'),
});

export const quizQuestionSchema = z.object({
  id: blockId,
  text: z.string().min(1).max(LIMITS.questionText),
  options: z.array(z.string().min(1).max(LIMITS.optionText)).min(LIMITS.optionsMin).max(LIMITS.optionsMax),
  correct: z.array(z.number().int().min(0)).min(1),
  multiple: z.boolean(),
  explain: z.string().max(LIMITS.explain).optional(),
});

export const quizBlockSchema = z.object({
  id: blockId,
  type: z.literal('quiz'),
  passScore: z.number().int().min(1).max(100),
  questions: z.array(quizQuestionSchema).min(1).max(LIMITS.questionsMax),
});

/** Межполевые правила блока (discriminatedUnion не принимает refine на ветках). */
function refineBlock(b: z.infer<typeof blockShapeSchema>, ctx: z.RefinementCtx): void {
  if (b.type === 'video' && b.provider === 'youtube' && !b.youtubeId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['youtubeId'], message: 'youtubeId is required for youtube' });
  }
  if (b.type === 'quiz') {
    const qids = new Set<string>();
    b.questions.forEach((q, qi) => {
      if (qids.has(q.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', qi, 'id'], message: 'duplicate question id' });
      }
      qids.add(q.id);
      const uniq = new Set(q.correct);
      if (uniq.size !== q.correct.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', qi, 'correct'], message: 'duplicate index' });
      }
      if (q.correct.some((i) => i >= q.options.length)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', qi, 'correct'], message: 'index out of range' });
      }
      if (!q.multiple && q.correct.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', qi, 'correct'],
          message: 'single-choice question must have exactly one correct option',
        });
      }
    });
  }
}

const blockShapeSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  textBlockSchema,
  videoBlockSchema,
  calloutBlockSchema,
  dividerBlockSchema,
  quizBlockSchema,
]);

export const blockSchema = blockShapeSchema.superRefine(refineBlock);

export const lessonDocSchema = z
  .object({
    v: z.literal(1),
    blocks: z.array(blockSchema).max(LIMITS.blocksMax),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    doc.blocks.forEach((b, i) => {
      if (ids.has(b.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks', i, 'id'], message: 'duplicate block id' });
      }
      ids.add(b.id);
    });
    // TextEncoder, а не Buffer: схема может использоваться и в браузере (редактор)
    if (new TextEncoder().encode(JSON.stringify(doc)).length > LIMITS.docBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'document too large' });
    }
  });

/** Контент урока по локалям: ru обязателен, kz — по возможности. */
export const lessonContentSchema = z.object({
  ru: lessonDocSchema,
  kz: lessonDocSchema.optional(),
});

/** Локализованная строка {ru, kz?}: ru непустой. */
export function l10nSchema(max = 300) {
  return z.object({
    ru: z.string().trim().min(1).max(max),
    kz: z.string().trim().max(max).optional(),
  });
}

/** Проверка контента урока. Возвращает результат safeParse. */
export function validateLessonContent(input: unknown) {
  return lessonContentSchema.safeParse(input);
}

/** Блоки без правильных ответов и пояснений — только это уходит на клиент до сдачи. */
export function toPublicBlocks(blocks: readonly Block[]): PublicBlock[] {
  return blocks.map((b): PublicBlock => {
    if (b.type !== 'quiz') return b;
    return {
      id: b.id,
      type: 'quiz',
      passScore: b.passScore,
      // явный список полей: correct и explain не копируются никогда
      questions: b.questions.map((q) => ({ id: q.id, text: q.text, options: [...q.options], multiple: q.multiple })),
    };
  });
}

// ---------- Проверка соответствия схем типам (только на этапе компиляции) ----------
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type _SchemaTypeChecks = [
  Assert<Same<z.infer<typeof headingBlockSchema>, HeadingBlock>>,
  Assert<Same<z.infer<typeof textBlockSchema>, TextBlock>>,
  Assert<Same<z.infer<typeof videoBlockSchema>, VideoBlock>>,
  Assert<Same<z.infer<typeof calloutBlockSchema>, CalloutBlock>>,
  Assert<Same<z.infer<typeof dividerBlockSchema>, DividerBlock>>,
  Assert<Same<z.infer<typeof quizQuestionSchema>, QuizQuestion>>,
  Assert<Same<z.infer<typeof quizBlockSchema>, QuizBlock>>,
  Assert<Same<z.infer<typeof blockSchema>, Block>>,
  Assert<Same<z.infer<typeof lessonDocSchema>, LessonDoc>>,
  Assert<Same<z.infer<typeof lessonContentSchema>, LessonContent>>,
  Assert<Same<z.infer<ReturnType<typeof l10nSchema>>, L10n>>,
];
