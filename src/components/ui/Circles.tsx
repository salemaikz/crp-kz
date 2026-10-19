import { cn } from './cn';

type Props = {
  className?: string;
};

/**
 * Декор: концентрические красные круги из знака логотипа ЦРП, статичные. Только первый экран
 * главной и финальная карточка заявки (D-023); на остальных страницах не использовать.
 * Позиционируется через className.
 */
export function Circles({ className }: Props) {
  return (
    <svg className={cn('circles', className)} viewBox="0 0 600 600" aria-hidden="true" focusable="false">
      <circle cx="300" cy="300" r="296" />
      <circle cx="300" cy="300" r="226" />
      <circle cx="300" cy="300" r="156" />
      <circle cx="300" cy="300" r="86" />
    </svg>
  );
}
