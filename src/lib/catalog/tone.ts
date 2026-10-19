/** Тона обложек: как цвета карточек кейсов на сайте ЦРП — тёмная панель с цветным свечением тона. */
export const COVER_TONES = ['#7a1f2b', '#1f3f8a', '#17695a', '#7a5a14', '#5b2a86'] as const;

/** FNV-1a (32 бита) по UTF-8 байтам: стабильный хеш без зависимостей. */
export function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(slug)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Тон обложки по slug курса: один и тот же курс всегда одного цвета — на главной и в каталоге. */
export function toneFor(slug: string): string {
  return COVER_TONES[hashSlug(slug) % COVER_TONES.length] ?? COVER_TONES[0];
}
