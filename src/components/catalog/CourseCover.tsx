import type { CSSProperties, ReactNode } from 'react';
import { cn, initials } from '@/components/ui';

/** Палитры «ночных» обложек: как карточки кейсов на сайте ЦРП — тёмный градиент и цветное свечение. */
const PALETTES = [
  { from: '#0b0f17', to: '#34183a', glow: 'rgb(227 30 36 / 42%)' },
  { from: '#0b0f17', to: '#18305f', glow: 'rgb(64 118 236 / 44%)' },
  { from: '#0e1726', to: '#4b3410', glow: 'rgb(232 170 52 / 40%)' },
  { from: '#0b0f17', to: '#0f433b', glow: 'rgb(48 190 150 / 36%)' },
] as const;

/** Детерминированный номер палитры по slug: у курса всегда один и тот же цвет. */
export function paletteIndex(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PALETTES.length;
}

/** Обложка — только свой (https или относительный) адрес; всё прочее рисуем градиентом. */
function safeCover(url: string | null): string | null {
  if (!url) return null;
  return /^(https:\/\/|\/(?!\/))/.test(url) ? url : null;
}

type Props = {
  slug: string;
  title: string;
  cover: string | null;
  /** Бейджи поверх обложки (уровень, статус). */
  children?: ReactNode;
  className?: string;
};

/** Обложка курса: градиент с кольцами и инициалами либо загруженная картинка. */
export function CourseCover({ slug, title, cover, children, className }: Props) {
  const p = PALETTES[paletteIndex(slug)] ?? PALETTES[0];
  const image = safeCover(cover);
  const style = { '--cv-from': p.from, '--cv-to': p.to, '--cv-glow': p.glow } as CSSProperties;
  return (
    <div className={cn('cat-cover', className)} style={style}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- внешний адрес обложки заранее неизвестен
        <img src={image} alt="" className="cat-cover__img" loading="lazy" />
      ) : (
        <>
          <svg className="cat-cover__rings" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            <circle cx="100" cy="100" r="96" />
            <circle cx="100" cy="100" r="68" />
            <circle cx="100" cy="100" r="40" />
          </svg>
          <span className="cat-cover__initials display" aria-hidden="true">
            {initials(title)}
          </span>
        </>
      )}
      {children && <div className="cat-cover__badges">{children}</div>}
    </div>
  );
}
