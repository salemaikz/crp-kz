// Бренд ЦРП для роликов: токены — копия docs/brand/tokens.css, шрифты — срезы из assets/fonts/pdf
// (их и логотип кладёт в public/ scripts/prepare.mjs). Правила — docs/brand/BRAND.md.
import { loadFont } from '@remotion/fonts';
import { Easing, staticFile } from 'remotion';

export const C = {
  board: '#f3f4f1',
  paper: '#ffffff',
  ink: '#14161b',
  ink2: '#4a4f59',
  ink3: '#6b707a',
  line: '#dcded8',
  lineStrong: '#8c919a',
  red: '#e31e24',
  redInk: '#c4161c',
  deep: '#0b0f17',
  onNight: '#e9ecf2',
  onNight2: '#a9b2c3',
  redOnNight: '#ff6b70',
};

// loadFont сам держит рендер (delayRender), пока шрифт не загружен.
loadFont({ family: 'Geologica', url: staticFile('fonts/Geologica-Bold-SHRP100.ttf'), weight: '700' });
loadFont({ family: 'Onest', url: staticFile('fonts/Onest-Regular.ttf'), weight: '400' });
loadFont({ family: 'Onest', url: staticFile('fonts/Onest-SemiBold.ttf'), weight: '600' });

export const display = {
  fontFamily: 'Geologica, Arial, sans-serif',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.04,
  whiteSpace: 'nowrap',
} as const;
export const body = { fontFamily: 'Onest, "Segoe UI", Arial, sans-serif' } as const;

// Кривые, как в HTML-роликах: появление, уход, перемещение; «щелчок» — с лёгким перелётом.
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const IN = Easing.bezier(0.7, 0, 0.84, 0);
export const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const POP = Easing.bezier(0.34, 1.56, 0.64, 1);
