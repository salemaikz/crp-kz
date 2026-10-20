// Мир версии 2: четыре этапа воронки — четыре экрана подряд, по 1920 px. На каждом справа куча
// точек (40 в ряд, снизу вверх), слева цифра и подпись. Модель считается один раз.
import { AFTER, BEFORE, T } from './timeline';

export const STATION = 1920;
export const COLS = 40;
export const GAP = 22.5;
export const R = 7;
export const GRID_LEFT = 860;
export const BOTTOM = 830;
// Точка хука: из неё раскрывается доска и разлетается тысяча заявок.
export const ORIGIN = { x: 1500, y: 540 };

export const BURST = 0.75;
export const FLIGHT = 1.2;
export const HOP = 0.8;
export const GRAVITY = 3200;
export const FALL = 1.6;

export type Tone = 'ink' | 'red' | 'gray';
export type Dot = {
  station: number;
  x: number;
  y: number;
  start: number;
  dur: number;
  from: { x: number; y: number };
  arc: number;
  tones: { t: number; tone: Tone }[];
};
// Потерянная заявка падает: копия точки с начальной скоростью и гравитацией; сама точка в куче сереет.
export type Fall = { x: number; y: number; start: number; vx: number; vy: number };

export const position = (station: number, i: number) => ({
  x: station * STATION + GRID_LEFT + (i % COLS) * GAP + R,
  y: BOTTOM - Math.floor(i / COLS) * GAP,
});
export const pileTop = (station: number, count: number) => BOTTOM - (count / COLS) * GAP;

// Детерминированный «случай»: одинаковый от рендера к рендеру.
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function build() {
  const dots = new Map<string, Dot>();
  const falls: Fall[] = [];
  const get = (station: number, i: number) => dots.get(`${station}:${i}`)!;
  const fly = (station: number, i: number, fromIndex: number, start: number, dur: number, arc: number, tone: Tone) =>
    dots.set(`${station}:${i}`, {
      station,
      ...position(station, i),
      from: position(station - 1, fromIndex),
      start,
      dur,
      arc,
      tones: [{ t: 0, tone }],
    });

  // Взрыв: тысяча точек разлетается из точки хука, ближние раньше.
  for (let i = 0; i < BEFORE[0]; i++) {
    const p = position(0, i);
    const dist = Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y);
    // Старт чуть позже раскрытия: к этому моменту круг доски уже заметно больше точки.
    dots.set(`0:${i}`, { station: 0, ...p, from: ORIGIN, start: T.burst + 0.1 + Math.min(0.5, dist / 1800), dur: BURST, arc: 0, tones: [{ t: 0, tone: 'ink' }] });
  }

  // Переходы: потерянные краснеют сверху вниз и падают, оставшиеся летят на следующий экран.
  T.steps.forEach((s, k) => {
    const n = BEFORE[k];
    const keep = BEFORE[k + 1];
    for (let i = keep; i < n; i++) {
      const lag = (1 - (i - keep) / (n - keep)) * 0.25;
      get(k, i).tones.push({ t: s + lag, tone: 'red' }, { t: s + 0.6 + lag, tone: 'gray' });
      falls.push({ ...position(k, i), start: s + 0.5 + rnd(i) * 0.35, vx: (rnd(i + 7) - 0.5) * 260, vy: -(200 + rnd(i + 13) * 260) });
    }
    for (let i = 0; i < keep; i++) fly(k + 1, i, i, s + 1 + (i / keep) * 0.4, FLIGHT, 40 + (i % 5) * 12, 'ink');
  });

  // Итог — покупки — красным, как ключевая цифра.
  for (let i = 0; i < BEFORE[3]; i++) get(3, i).tones.push({ t: T.result + (i % COLS) * 0.008, tone: 'red' });

  // Каскад в общем плане: 150 серых на первом экране снова в игре; дальше идут именно они —
  // из только что пришедших та же доля проходит, остальные теряются.
  T.improve.forEach((s, k) => {
    const pass = AFTER[k + 1] - BEFORE[k + 1];
    const from = k === 0 ? BEFORE[1] : BEFORE[k];
    const to = k === 0 ? AFTER[1] : AFTER[k];
    const source = Array.from({ length: to - from }, (_, j) => from + j);
    const going = source.slice(0, pass);
    if (k === 0) going.forEach((i, j) => get(k, i).tones.push({ t: s + (j / pass) * 0.3, tone: 'ink' }));
    source.slice(pass).forEach((i) => get(k, i).tones.push({ t: s, tone: 'red' }, { t: s + 0.8, tone: 'gray' }));
    const spread = Math.min(0.5, pass * 0.006);
    going.forEach((i, j) => fly(k + 1, BEFORE[k + 1] + j, i, s + 0.3 + (j / pass) * spread, HOP, 260 + (j % 5) * 40, k + 1 === 3 ? 'red' : 'ink'));
  });

  return { dots: [...dots.values()], falls };
}

export const { dots: DOTS, falls: FALLS } = build();

// Сколько точек уже на этапе к моменту t — для больших цифр.
const landings = [0, 1, 2, 3].map((station) =>
  DOTS.filter((d) => d.station === station)
    .map((d) => d.start + d.dur)
    .sort((a, b) => a - b),
);
export function countAt(station: number, t: number) {
  const list = landings[station];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
