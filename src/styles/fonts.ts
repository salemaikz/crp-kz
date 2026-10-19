import { Geologica, Onest } from 'next/font/google';

// Шрифты бренда (BRAND.md). cyrillic-ext обязателен: без него нет ә ғ қ ң ө ұ ү һ і.
// next/font требует литералы в аргументах — общий массив subsets вынести нельзя.

/** Заголовки и цифры: вариативный Geologica с осью SHRP («острота»). */
export const geologica = Geologica({
  subsets: ['cyrillic', 'cyrillic-ext', 'latin'],
  axes: ['SHRP'],
  variable: '--font-geologica',
  display: 'swap',
});

/** Текст и интерфейс. */
export const onest = Onest({
  subsets: ['cyrillic', 'cyrillic-ext', 'latin'],
  variable: '--font-onest',
  display: 'swap',
});

/** Классы с CSS-переменными шрифтов — повесить на <html>. */
export const fontVariables = [geologica.variable, onest.variable].join(' ');
