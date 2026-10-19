// Человеческие сообщения о проблемах контента урока (из путей и кодов zod).
import type { ContentIssue } from '@/lib/admin/errors';

type T = (key: string, values?: Record<string, string | number>) => string;

const FIELD_KEYS = new Set(['text', 'markdown', 'caption', 'explain', 'options', 'correct', 'passScore', 'youtubeId', 'questions', 'level', 'tone', 'provider']);

/** Путь внутри блока: после ['ru', 'blocks', i]. */
export function pathInBlock(issue: ContentIssue): Array<string | number> {
  return issue.path.slice(3);
}

/** Проблемы, относящиеся к блоку номер index локали locale. */
export function issuesForBlock(issues: readonly ContentIssue[], locale: string, index: number): ContentIssue[] {
  return issues.filter((i) => i.path[0] === locale && i.path[1] === 'blocks' && i.path[2] === index);
}

/** t — useTranslations('admin.lessonEditor.issue'). */
export function describeIssue(issue: ContentIssue, t: T): string {
  const rest = pathInBlock(issue);
  const qi = rest[0] === 'questions' && typeof rest[1] === 'number' ? rest[1] : null;
  const oi = rest[2] === 'options' && typeof rest[3] === 'number' ? rest[3] : null;
  const prefix = qi !== null ? `${t('question', { n: qi + 1 })}: ` : '';
  const key = [...rest].reverse().find((p): p is string => typeof p === 'string') ?? '';
  const field = FIELD_KEYS.has(key) ? t(`fields.${key}`) : t('fields.generic');
  const min = issue.minimum ?? 0;
  const max = issue.maximum ?? 0;

  let body: string;
  switch (issue.message) {
    case 'youtubeId is required for youtube':
      body = t('youtubeRequired');
      break;
    case 'duplicate question id':
    case 'duplicate block id':
      body = t('duplicateId');
      break;
    case 'duplicate index':
      body = t('duplicateCorrect');
      break;
    case 'index out of range':
      body = t('correctOutOfRange');
      break;
    case 'single-choice question must have exactly one correct option':
      body = t('singleNeedsOne');
      break;
    case 'document too large':
      body = t('tooLarge');
      break;
    default:
      body = byCode();
  }
  return `${prefix}${body}`;

  function byCode(): string {
    switch (issue.code) {
      case 'too_small':
        if (issue.type === 'string') return oi !== null ? t('optionEmpty', { n: oi + 1 }) : t('required', { field });
        if (issue.type === 'array') {
          if (key === 'options') return t('optionsMin', { min });
          if (key === 'correct') return t('correctMin');
          if (key === 'questions') return t('questionsMin');
        }
        return t('numberMin', { field, min });
      case 'too_big':
        if (issue.type === 'string') return oi !== null ? t('optionTooLong', { n: oi + 1, max }) : t('tooLong', { field, max });
        if (issue.type === 'array') {
          if (key === 'options') return t('optionsMax', { max });
          if (key === 'questions') return t('questionsMax', { max });
          if (key === 'blocks') return t('blocksMax', { max });
        }
        return t('numberMax', { field, max });
      case 'invalid_string':
        return key === 'youtubeId' ? t('youtubeInvalid') : t('invalid', { field });
      default:
        return t('invalid', { field });
    }
  }
}
