import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'header' | 'footer' | 'aside';
  /** board — «доска» (фон страницы); paper — белая; night — тёмная «ночь». */
  tone?: 'board' | 'paper' | 'night';
  /** Вертикальные отступы: default 72–128 px, tight 48–80 px, none — без отступов. */
  spacing?: 'default' | 'tight' | 'none';
  /** Для night: радиальное красное свечение, как на первом экране сайта. */
  glow?: boolean;
  /** Для светлых секций: фирменные кольца справа (как блок «Формула прибыли»). */
  rings?: boolean;
  children?: ReactNode;
};

/** Секция страницы с фоном и ритмом отступов из редизайна. */
export function Section({
  as: Tag = 'section',
  tone = 'board',
  spacing = 'default',
  glow,
  rings,
  className,
  children,
  ...rest
}: Props) {
  return (
    <Tag
      className={cn(
        'section',
        `section--${tone}`,
        spacing === 'tight' && 'section--tight',
        spacing === 'none' && 'section--flush',
        glow && 'section--glow section--clip',
        rings && 'section--rings',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
