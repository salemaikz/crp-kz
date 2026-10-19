// Единственный реестр версий юридических документов (D-035). Чистые данные и функции, без fs:
// файл импортируется и из features.ts. Хэши файлов content/legal/** проверяет тест (задача 1B).
import {
  CONSENT_DOC,
  LEGAL_DOC_KINDS,
  type ConsentKind,
  type LegalDocKind,
  type LegalVersion,
} from './types';

/** Старшая версия каждого вида — первая в массиве. Версии появятся в задаче 1B. */
export const LEGAL_VERSIONS: readonly LegalVersion[] = [];

const ALMATY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' });

/** Сегодняшняя дата 'YYYY-MM-DD' по Астане. */
function todayAlmaty(): string {
  return ALMATY_DATE.format(new Date());
}

export function versionsOf(kind: LegalDocKind): readonly LegalVersion[] {
  return LEGAL_VERSIONS.filter((v) => v.kind === kind);
}

export function findVersion(kind: LegalDocKind, version: string): LegalVersion | null {
  return LEGAL_VERSIONS.find((v) => v.kind === kind && v.version === version) ?? null;
}

/** Действующая версия: старшая с effectiveFrom <= today. Черновики — только если allowDrafts. */
export function currentVersion(
  kind: LegalDocKind,
  opts: { allowDrafts: boolean; today?: string },
): LegalVersion | null {
  const today = opts.today ?? todayAlmaty();
  return (
    versionsOf(kind).find((v) => v.effectiveFrom <= today && (opts.allowDrafts || !v.draft)) ?? null
  );
}

/**
 * Токен показанных версий для формы: 'offer@2026-10-20;pd_consent@2026-10-20' (сортировка по
 * виду документа). Нет действующей версии — 'вид@none', чтобы её появление меняло токен.
 */
export function versionsToken(kinds: readonly ConsentKind[], opts: { allowDrafts: boolean }): string {
  const docs = [...new Set(kinds.map((k) => CONSENT_DOC[k]).filter((d): d is LegalDocKind => d !== null))].sort();
  return docs.map((d) => `${d}@${currentVersion(d, opts)?.version ?? 'none'}`).join(';');
}

/**
 * Все четыре документа можно публиковать в проде: действующая версия draft:false
 * и есть казахский текст (К-21).
 */
export function legalPublishable(today?: string): boolean {
  return LEGAL_DOC_KINDS.every((k) => {
    const v = currentVersion(k, { allowDrafts: false, today });
    return v !== null && v.sha256.kz !== null;
  });
}
