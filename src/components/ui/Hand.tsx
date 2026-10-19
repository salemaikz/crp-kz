import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  children: ReactNode;
  as?: 'span' | 'p';
  /** Наклон в градусах (по умолчанию −3°). */
  rotate?: number;
  /** Размер шрифта, px (по умолчанию 25). */
  size?: number;
  className?: string;
};

/** Рукописная красная пометка (Caveat). Не больше одной на экран. */
export function Hand({ children, as: Tag = 'span', rotate = -3, size, className }: Props) {
  const style: CSSProperties = { transform: `rotate(${rotate}deg)`, ...(size ? { fontSize: size } : {}) };
  return (
    <Tag className={cn('hand', className)} style={style}>
      {children}
    </Tag>
  );
}
