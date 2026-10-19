// Транслитерация названий в slug (адрес страницы): русский и казахский → латиница.
// Файл без серверных зависимостей: им пользуется и форма курса в браузере (подсказка адреса).

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // казахские буквы
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
  '№': '',
};

/** Допустимый slug: латиница, цифры и одиночные дефисы между ними. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MAX = 60;

/** «Целина: основы бизнеса» → «tselina-osnovy-biznesa». Пустая строка, если букв и цифр нет. */
export function slugify(input: string, max: number = SLUG_MAX): string {
  let out = '';
  for (const ch of input.toLowerCase()) out += MAP[ch] ?? ch;
  const slug = out
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '') // диакритика латиницы (é → e)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  // обрезаем по границе слова, если она не слишком близко к началу
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '');
}

/** Первый свободный slug: base, base-2, base-3 … `taken` — проверка занятости. */
export async function pickFreeSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error('no free slug');
}
