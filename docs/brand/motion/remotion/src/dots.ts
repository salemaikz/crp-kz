// Точки воронки: каждая — заявка. Кучи — «столбики» из точек по 25 в ряд, снизу вверх.
// Модель считается один раз: где точка стоит, когда появляется или вылетает и как меняет цвет.
import { AFTER, BEFORE, T } from './timeline';

export const COLS = 25;
export const GAP = 12;
export const R = 4;
export const BOTTOM = 800;
export const PILE_WIDTH = (COLS - 1) * GAP + 2 * R;
export const LEFTS = [0, 1, 2, 3].map((k) => Math.round(160 + k * (PILE_WIDTH + (1600 - 4 * PILE_WIDTH) / 3)));

export const FLIGHT = 0.7;
export const POP_TIME = 0.35;

export type Tone = 'ink' | 'red' | 'gray';
export type Dot = {
  pile: number;
  x: number;
  y: number;
  // Куча 1 — время появления; остальные — время вылета из предыдущей кучи.
  start: number;
  from?: { x: number; y: number };
  arc: number;
  tones: { t: number; tone: Tone }[];
};

export const position = (pile: number, i: number) => ({
  x: LEFTS[pile] + (i % COLS) * GAP + R,
  y: BOTTOM - Math.floor(i / COLS) * GAP,
});

function build(): Dot[] {
  const dots = new Map<string, Dot>();
  const get = (pile: number, i: number) => dots.get(`${pile}:${i}`)!;
  const fly = (pile: number, i: number, fromIndex: number, start: number, tone: Tone) =>
    dots.set(`${pile}:${i}`, {
      pile,
      ...position(pile, i),
      from: position(pile - 1, fromIndex),
      start,
      arc: 110 + (i % 7) * 10,
      tones: [{ t: 0, tone }],
    });

  // Тысяча заявок появляется ряд за рядом.
  for (let i = 0; i < BEFORE[0]; i++) {
    const row = Math.floor(i / COLS);
    dots.set(`0:${i}`, { pile: 0, ...position(0, i), start: T.fill + row * 0.045 + (i % COLS) * 0.003, arc: 0, tones: [{ t: 0, tone: 'ink' }] });
  }

  // Прямой проход: потерянные краснеют сверху вниз и гаснут, дошедшие перелетают дальше волной.
  T.steps.forEach((s, k) => {
    const n = BEFORE[k];
    const keep = BEFORE[k + 1];
    for (let i = keep; i < n; i++) {
      const lag = (1 - (i - keep) / (n - keep)) * 0.3;
      get(k, i).tones.push({ t: s + lag, tone: 'red' }, { t: s + 1 + lag, tone: 'gray' });
    }
    for (let i = 0; i < keep; i++) fly(k + 1, i, i, s + 0.6 + (i / keep) * 1.2, 'ink');
  });

  // Итог — покупки — красным, как ключевая цифра.
  for (let i = 0; i < BEFORE[3]; i++) get(3, i).tones.push({ t: T.result + (i % COLS) * 0.01, tone: 'red' });

  // Каскад: дозвон 75% — 150 серых в первой куче снова в игре. Дальше по этапам идут именно они:
  // из только что пришедших та же доля проходит, остальные теряются.
  T.improve.forEach((s, k) => {
    const pass = AFTER[k + 1] - BEFORE[k + 1];
    const from = k === 0 ? BEFORE[1] : BEFORE[k];
    const to = k === 0 ? AFTER[1] : AFTER[k];
    const source = Array.from({ length: to - from }, (_, j) => from + j);
    const going = source.slice(0, pass);
    if (k === 0) going.forEach((i, j) => get(k, i).tones.push({ t: s + (j / pass) * 0.4, tone: 'ink' }));
    source.slice(pass).forEach((i) => get(k, i).tones.push({ t: s, tone: 'red' }, { t: s + 1, tone: 'gray' }));
    const spread = Math.min(0.8, pass * 0.01);
    going.forEach((i, j) => fly(k + 1, BEFORE[k + 1] + j, i, s + 0.5 + (j / pass) * spread, k + 1 === 3 ? 'red' : 'ink'));
  });

  return [...dots.values()];
}

export const DOTS = build();

// Сколько точек уже в куче к моменту t — для счётчиков над кучами.
const landings = [0, 1, 2, 3].map((pile) =>
  DOTS.filter((d) => d.pile === pile)
    .map((d) => (pile === 0 ? d.start : d.start + FLIGHT))
    .sort((a, b) => a - b),
);
export function countAt(pile: number, t: number) {
  const list = landings[pile];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
