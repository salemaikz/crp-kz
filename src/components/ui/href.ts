/** Ссылка ведёт наружу (или это якорь/почта/телефон) — рендерим обычный <a>, без локали. */
export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/i.test(href);
}
