// Мета-данные страниц: канонический адрес и альтернативы по языкам (hreflang — ISO kk, а не kz, D-002).
import type { Metadata } from 'next';

/** path — путь без локали ('/courses/celina'; для главной — ''). */
export function localeAlternates(locale: string, path: string): NonNullable<Metadata['alternates']> {
  const current = locale === 'kz' ? 'kz' : 'ru';
  return {
    canonical: `/${current}${path}`,
    languages: { ru: `/ru${path}`, kk: `/kz${path}`, 'x-default': `/ru${path}` },
  };
}

/** Описание для <meta>: без переводов строк, до 160 знаков. */
export function metaDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}
