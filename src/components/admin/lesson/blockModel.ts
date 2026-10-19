// Модель редактора блоков: создание блоков, перестановка, разбор ссылки YouTube, нормализация перед сохранением.
// Чистые функции без React — их легко проверять.
import type { Block, QuizBlock, QuizQuestion } from '@/lib/content/types';

export type BlockType = Block['type'];
/** Типы, которые создаются кнопкой «Добавить блок». Блоки image и file появляются из загруженного файла (D-034). */
export type AddableBlockType = Exclude<BlockType, 'image' | 'file'>;

/** Порядок кнопок «Добавить блок». */
export const BLOCK_TYPES: readonly AddableBlockType[] = ['heading', 'text', 'video', 'callout', 'quiz', 'divider'];

/** Короткий id для блока или вопроса (в браузере без crypto.randomUUID — запасной вариант). */
export function uid(prefix = 'b'): string {
  const c = globalThis.crypto;
  const raw =
    typeof c?.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '')
      : Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join('');
  return `${prefix}${raw.slice(0, 8)}`;
}

export function newQuestion(): QuizQuestion {
  return { id: uid('q'), text: '', options: ['', ''], correct: [0], multiple: false };
}

export function newBlock(type: AddableBlockType): Block {
  const id = uid('b');
  switch (type) {
    case 'heading':
      return { id, type, level: 2, text: '' };
    case 'text':
      return { id, type, markdown: '' };
    case 'video':
      return { id, type, provider: 'placeholder', caption: '' };
    case 'callout':
      return { id, type, tone: 'info', text: '' };
    case 'divider':
      return { id, type };
    case 'quiz':
      return { id, type, passScore: 70, questions: [newQuestion()] };
  }
}

/** Копия списка со сдвигом элемента; null, если двигать некуда. */
export function moved<T>(list: readonly T[], index: number, dir: 'up' | 'down'): T[] | null {
  const j = dir === 'up' ? index - 1 : index + 1;
  if (j < 0 || j >= list.length) return null;
  const copy = [...list];
  [copy[index], copy[j]] = [copy[j] as T, copy[index] as T];
  return copy;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** ID ролика из ссылки YouTube (watch, youtu.be, embed, shorts, live) или из самого ID. */
export function parseYoutubeId(input: string): string | null {
  const raw = input.trim();
  if (YT_ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id) {
      const [kind, value] = url.pathname.split('/').filter(Boolean);
      if (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') id = value ?? null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

const trimOrUndefined = (s: string | undefined): string | undefined => {
  const v = s?.trim();
  return v ? v : undefined;
};

/** Приводит блоки к хранимому виду: убирает пустые необязательные поля и лишние пробелы. */
export function normalizeBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case 'heading':
        return { ...b, text: b.text.trim() };
      case 'callout':
        return { ...b, text: b.text.trim() };
      case 'video': {
        const caption = trimOrUndefined(b.caption);
        const out: Block = { id: b.id, type: 'video', provider: b.provider };
        if (b.provider === 'youtube' && b.youtubeId) out.youtubeId = b.youtubeId.trim();
        if (caption) out.caption = caption;
        return out;
      }
      case 'quiz': {
        const quiz: QuizBlock = {
          ...b,
          questions: b.questions.map((q) => {
            const explain = trimOrUndefined(q.explain);
            const { explain: _drop, ...rest } = q;
            void _drop;
            return { ...rest, text: q.text.trim(), options: q.options.map((o) => o.trim()), ...(explain ? { explain } : {}) };
          }),
        };
        return quiz;
      }
      default:
        return b;
    }
  });
}

/** Копия блоков для другой локали (те же id: тест засчитывается независимо от языка). */
export function cloneBlocks(blocks: readonly Block[]): Block[] {
  return JSON.parse(JSON.stringify(blocks)) as Block[];
}
