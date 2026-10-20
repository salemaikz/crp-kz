// Типы и лимиты загрузки файлов (D-034). Чистые константы: импортируются и сервером, и браузером.

export const FILE_TYPES = {
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'document' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
} as const;
export type FileExt = keyof typeof FILE_TYPES;
export type FileKind = 'image' | 'document';

const MiB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  imageBytes: 5 * MiB,
  documentBytes: 25 * MiB,
  /** Vercel режет тело функции на 4,5 МБ, Netlify — на 6 МБ. */
  serverlessDemoBytes: 4 * MiB,
  imageMaxSide: 10_000,
  /** Защита браузера от «пиксельной бомбы». */
  imageMaxPixels: 40_000_000,
  coverMinWidth: 800,
  coverMinHeight: 450,
  nameMax: 120,
  zipMaxEntries: 5_000,
  zipMaxCentralDirBytes: 4 * MiB,
  /** Распаковка [Content_Types].xml. */
  contentTypesMaxBytes: 1 * MiB,
  uploadsPerUser: { limit: 60, windowMs: 10 * 60_000 },
  concurrentPerUser: 3,
  minFreeDiskBytes: 1024 * MiB,
  /** Демо на serverless: весь /tmp площадки около 512 МБ, порог в 1 ГиБ закрыл бы загрузку совсем. */
  serverlessDemoMinFreeBytes: 64 * MiB,
  /** UPLOAD_QUOTA_BYTES по умолчанию. */
  totalQuotaBytesDefault: 20 * 1024 * MiB,
  /** UPLOAD_COURSE_QUOTA_BYTES по умолчанию. */
  courseQuotaBytesDefault: 2 * 1024 * MiB,
  orphanGraceMs: 24 * 60 * 60_000,
  tempGraceMs: 60 * 60_000,
  downloadsPerUser: { limit: 600, windowMs: 10 * 60_000 },
  downloadsPerIpGuest: { limit: 600, windowMs: 60_000 },
} as const;

export const PURPOSE_TYPES: Record<'lesson_material' | 'course_cover', readonly FileExt[]> = {
  lesson_material: ['png', 'jpg', 'webp', 'pdf', 'docx', 'xlsx'],
  course_cover: ['png', 'jpg', 'webp'],
};
