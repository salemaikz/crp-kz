// Единственный реестр версий юридических документов (D-035). Чистые данные и функции, без fs:
// файл импортируется и из features.ts. Хэши файлов content/legal/** проверяет тест legal-registry.
import {
  CONSENT_DOC,
  LEGAL_DOC_KINDS,
  type ConsentKind,
  type LegalDocKind,
  type LegalVersion,
} from './types';

/**
 * Старшая версия каждого вида — первая в массиве. Все четыре документа пока черновики-заглушки
 * (draft: true): настоящие тексты готовит юрист ЦРП, при утверждении добавляется новая версия.
 * Хэши — SHA-256 нормализованных файлов content/legal/** (сверяет tests/unit/legal-registry).
 */
export const LEGAL_VERSIONS: readonly LegalVersion[] = [
  {
    kind: 'offer',
    version: '2026-10-20',
    effectiveFrom: '2026-10-20',
    draft: true,
    sha256: {
      ru: '550f100dc11bc818fed64450c1e51ae46a004ab18726bc73dc056b8c8b097017',
      kz: 'e66231b914ca3d78b276304dcb4a3067d0af6a64dcba31a28b3275237dc85a94',
    },
  },
  {
    kind: 'privacy',
    version: '2026-10-20',
    effectiveFrom: '2026-10-20',
    draft: true,
    sha256: {
      ru: 'fbd7201505d14a42ea4f6cb4299914c92e52d9309c8806bb573a7c60811cb5ca',
      kz: 'ecb1e20ef4093e52da97e601082c484b978139581b42be68b222a02c9877d8bc',
    },
  },
  {
    kind: 'pd_consent',
    version: '2026-10-20',
    effectiveFrom: '2026-10-20',
    draft: true,
    sha256: {
      ru: '9f841c0891bd330c2d3c3139df56c2a32acdca42a4e0d4e257dfff8818921be9',
      kz: '47140c9f7ed80e727184d2bd8d069a5f267d87a0dce19f8060982ea45e79ef25',
    },
  },
  {
    kind: 'refund',
    version: '2026-10-20',
    effectiveFrom: '2026-10-20',
    draft: true,
    sha256: {
      ru: '4ed947f1ec4490e311ac30c3881cfebc2b45570be8da1e5751f3a16c57b223f5',
      kz: '7b5fef7e52d6838558c3d04efb2a4bd44f521c15ebfcf657b2a29d57193123a5',
    },
  },
];

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

/** Версии, видимые сейчас: вступили в силу, черновики — только если allowDrafts. Новые — первыми. */
export function visibleVersions(
  kind: LegalDocKind,
  opts: { allowDrafts: boolean; today?: string },
): readonly LegalVersion[] {
  const today = opts.today ?? todayAlmaty();
  return versionsOf(kind).filter((v) => v.effectiveFrom <= today && (opts.allowDrafts || !v.draft));
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
