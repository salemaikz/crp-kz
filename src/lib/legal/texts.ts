// Загрузка текстов документов с диска. Только сервер. Путь строится ТОЛЬКО из записи реестра,
// параметры запроса в него не попадают (path traversal закрыт на уровне findVersion).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { legalSha256, normalizeLegalSource, splitTitle } from './source';
import { LEGAL_DOC_SLUG, type LegalText, type LegalVersion } from './types';

type TextLocale = 'ru' | 'kz';

const cache = new Map<string, LegalText>();

/** Путь файла относительно корня проекта: content/legal/<slug>/<version>.<locale>.md. */
export function legalFileRel(v: Pick<LegalVersion, 'kind' | 'version'>, locale: TextLocale): string {
  return path.join('content', 'legal', LEGAL_DOC_SLUG[v.kind], `${v.version}.${locale}.md`);
}

/**
 * Текст версии на языке locale. Нет казахского хэша в реестре — запасной ru (fallback).
 * Хэш файла не совпал с реестром — Error (fail closed): ни показа, ни записи согласия.
 */
export async function loadLegalText(v: LegalVersion, locale: TextLocale): Promise<LegalText> {
  const shown: TextLocale = locale === 'kz' && v.sha256.kz !== null ? 'kz' : 'ru';
  const expected = shown === 'kz' ? v.sha256.kz : v.sha256.ru;
  if (expected === null) throw new Error(`legal: нет хэша ${v.kind}@${v.version}.${shown}`);

  const key = `${v.kind}@${v.version}.${shown}.${expected}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = await readFile(path.join(process.cwd(), legalFileRel(v, shown)), 'utf8');
  const source = normalizeLegalSource(raw);
  const sha256 = legalSha256(source);
  if (sha256 !== expected) {
    // содержимое документа в сообщение не попадает
    throw new Error(`legal: хэш файла ${v.kind}@${v.version}.${shown} не совпал с реестром`);
  }
  const { title, body } = splitTitle(source);
  const text: LegalText = {
    kind: v.kind,
    version: v.version,
    draft: v.draft,
    effectiveFrom: v.effectiveFrom,
    locale: shown,
    fallback: locale !== shown,
    title,
    body,
    source,
    sha256,
  };
  cache.set(key, text);
  return text;
}
