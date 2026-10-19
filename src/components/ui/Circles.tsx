import { cn } from './cn';

type Props = {
  /** red — для тёмного фона (как на первом экране сайта); light — бледные для светлого. */
  tone?: 'red' | 'light';
  /** Плавное появление колец. */
  animated?: boolean;
  className?: string;
};

/** Декор: концентрические круги из знака логотипа ЦРП. Позиционируется через className. */
export function Circles({ tone = 'red', animated = true, className }: Props) {
  return (
    <svg
      className={cn('circles', `circles--${tone}`, animated && 'circles--animated', className)}
      viewBox="0 0 600 600"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="300" cy="300" r="296" />
      <circle cx="300" cy="300" r="226" />
      <circle cx="300" cy="300" r="156" />
      <circle cx="300" cy="300" r="86" />
    </svg>
  );
}
