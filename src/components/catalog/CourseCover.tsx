import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui';
import { toneFor } from '@/lib/catalog/tone';

/** Обложка — только свой (https или относительный) адрес; всё прочее рисуем панелью тона. */
function safeCover(url: string | null): string | null {
  if (!url) return null;
  return /^(https:\/\/|\/(?!\/))/.test(url) ? url : null;
}

type Props = {
  /** Slug курса: по его хешу выбирается тон, поэтому цвет курса везде одинаков. */
  slug: string;
  cover: string | null;
  /** Полезный факт на панели: «15 уроков» крупно и длительность мелко. */
  children?: ReactNode;
  className?: string;
};

/**
 * Обложка курса: тёмная панель тона курса с фактом сверху карточки либо загруженное фото
 * (сверху, где текст, затемнение плотнее). Без букв-монограмм и колец.
 */
export function CourseCover({ slug, cover, children, className }: Props) {
  const image = safeCover(cover);
  const style = { '--tone': toneFor(slug) } as CSSProperties;
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
