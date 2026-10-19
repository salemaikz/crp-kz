import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui';

/** Тона обложек: как цвета карточек кейсов на сайте ЦРП — тёмная панель с цветным свечением тона. */
const TONES = ['#7a1f2b', '#1f3f8a', '#17695a', '#7a5a14', '#5b2a86'] as const;

/** Детерминированный номер тона по slug: у курса всегда один и тот же цвет. */
export function toneIndex(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TONES.length;
}

/** Обложка — только свой (https или относительный) адрес; всё прочее рисуем панелью тона. */
function safeCover(url: string | null): string | null {
  if (!url) return null;
  return /^(https:\/\/|\/(?!\/))/.test(url) ? url : null;
}

type Props = {
  slug: string;
  cover: string | null;
  /** Полезный факт на панели: «15 уроков» крупно и длительность мелко. */
  children?: ReactNode;
  className?: string;
};

/**
 * Обложка курса: тёмная панель тона курса с фактом сверху карточки либо загруженное фото
 * (под текстом — сплошной тёмный градиент для читаемости). Без букв-монограмм и колец.
 */
export function CourseCover({ slug, cover, children, className }: Props) {
  const image = safeCover(cover);
  const style = { '--tone': TONES[toneIndex(slug)] ?? TONES[0] } as CSSProperties;
  return (
    <div className={cn('cat-cover', image && 'cat-cover--image', className)} style={style}>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- внешний адрес обложки заранее неизвестен
        <img src={image} alt="" className="cat-cover__img" loading="lazy" />
      )}
      {children && <div className="cat-cover__fact">{children}</div>}
    </div>
  );
}
