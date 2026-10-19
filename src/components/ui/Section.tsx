import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'header' | 'footer' | 'aside';
  /** board — «доска» (фон страницы); paper — белая; night — тёмная «ночь». */
  tone?: 'board' | 'paper' | 'night';
  /** Вертикальные отступы: default 64–104 px, tight 48–80 px, none — без отступов. */
  spacing?: 'default' | 'tight' | 'none';
  children?: ReactNode;
};

/** Секция страницы с фоном и ритмом отступов из редизайна (по умолчанию 64–104 px). */
export function Section({
  as: Tag = 'section',
  tone = 'board',
  spacing = 'default',
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
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
