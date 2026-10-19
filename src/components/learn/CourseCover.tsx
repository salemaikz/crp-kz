import type { CSSProperties, ReactNode } from 'react';
import { GraduationCap } from 'lucide-react';
import { Circles } from '@/components/ui';
import './learn.css';

// Свечение и кольца чуть смещаются от карточки к карточке — ряд не выглядит копией
const VARIANTS: Array<Record<string, string>> = [
  { '--glow-x': '82%', '--rings-x': '-14%' },
  { '--glow-x': '68%', '--rings-x': '-6%' },
  { '--glow-x': '90%', '--rings-x': '-22%' },
  { '--glow-x': '74%', '--rings-x': '-10%' },
];

function isImageUrl(src: string | null): src is string {
  return !!src && /^(https:\/\/|\/(?!\/))/.test(src);
}

/** Обложка курса: картинка из cover или фирменная заставка (свечение, кольца, значок). */
export function CourseCover({ cover, index = 0, badges }: { cover: string | null; index?: number; badges?: ReactNode }) {
  const style = VARIANTS[index % VARIANTS.length] as CSSProperties;
  return (
    <div className="lrn-course__cover" style={style}>
      {isImageUrl(cover) ? (
        // eslint-disable-next-line @next/next/no-img-element -- обложка по произвольному адресу из админки
        <img src={cover} alt="" className="lrn-course__img" loading="lazy" />
      ) : (
        <>
          <Circles />
          <span className="lrn-course__glyph" aria-hidden="true">
            <GraduationCap />
          </span>
        </>
      )}
      {badges && <div className="lrn-course__badges">{badges}</div>}
    </div>
  );
}
