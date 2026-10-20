// Сценарий ролика «Где теряются заявки»: данные, тайминг и звуки.
// Модуль без зависимостей: его читает и композиция, и scripts/prepare.mjs (Node импортирует .ts
// напрямую), поэтому звуки и картинка берут время из одного места.

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Условный пример воронки: 1 000 заявок, 60% дозвона, 40% доходят до встречи, 25% покупают.
// Во второй половине улучшается только дозвон — до 75%.
export const STAGES = ['Заявки', 'Дозвонились', 'Пришли на встречу', 'Купили'];
export const BEFORE = [1000, 600, 240, 60];
export const AFTER = [1000, 750, 300, 75];
export const RATES = ['', '60% заявок', '40% из них', '25% из них'];
export const RATE_AFTER = '75% заявок';

// Время, секунды.
export const T = {
  intro: 0.2,
  headingShrink: 2.6,
  fill: 3.3,
  // Шаг k: в куче k гаснут потерянные, оставшиеся перелетают в кучу k + 1.
  steps: [6.6, 10.0, 13.4],
  result: 16.8,
  summary: 18.0,
  zoomIn: 21.4,
  better: 22.6,
  // Каскад улучшения: новые дозвонившиеся проходят дальше по воронке.
  improve: [23.4, 25.6, 27.8],
  zoomOut: 25.2,
  final: 30.2,
  end: 34.4,
  total: 40.4,
};

export const HEADINGS = [
  { text: 'Где теряются заявки', from: T.intro },
  { text: 'Из 1 000 заявок купили 60', from: T.summary },
  { text: 'Если дозваниваться до 75% заявок', from: T.better },
  { text: 'Те же 1 000 заявок — 75 покупок вместо 60', from: T.final },
];

export const frames = (seconds: number) => Math.round(seconds * FPS);

// Звуки для ../sound.mjs: t — миллисекунды.
type Cue = { t: number; type: string; [param: string]: number | string };
const cue = (seconds: number, type: string, params: Record<string, number | string> = {}): Cue => ({
  t: Math.round(seconds * 1000),
  type,
  ...params,
});

const MOTIF = ['C5', 'E5', 'G5'];

export const CUES: Cue[] = [
  cue(T.intro, 'note', { note: 'C4', gain: 0.22 }),
  cue(T.headingShrink, 'whoosh', { dur: 800, from: 2600, to: 700 }),
  // Куча из тысячи точек наполняется: частые тихие тики, высота растёт вместе с кучей.
  ...Array.from({ length: 20 }, (_, i) => cue(T.fill + i * 0.09, 'tick', { freq: 1200 + i * 60, gain: 0.05 })),
  cue(T.fill + 1.9, 'note', { note: 'G4', gain: 0.16 }),
  ...T.steps.flatMap((s, k) => [
    cue(s, 'thump', { gain: 0.22 }),
    cue(s + 0.6, 'whoosh', { dur: 1300, from: 500, to: 2200, gain: 0.06 }),
    cue(s + 2.2, 'note', { note: MOTIF[k] }),
  ]),
  cue(T.result, 'chime', { note: 'C6' }),
  cue(T.summary, 'tick'),
  cue(T.zoomIn, 'whoosh', { dur: 1000, from: 400, to: 1800 }),
  cue(T.better, 'tick'),
  // Улучшение: серые точки снова чернеют — короткая восходящая россыпь, затем тот же мотив.
  ...Array.from({ length: 8 }, (_, i) => cue(T.improve[0] + i * 0.05, 'tick', { freq: 1600 + i * 150, gain: 0.06 })),
  ...T.improve.map((s, k) => cue(s + 1.4, 'note', { note: ['D5', 'G5', 'A5'][k] })),
  cue(T.zoomOut, 'whoosh', { dur: 1000, from: 1800, to: 400 }),
  cue(T.improve[2] + 1.5, 'chime', { note: 'C6' }),
  cue(T.final, 'tick'),
  cue(T.end, 'whoosh', { dur: 900, from: 300, to: 1200, gain: 0.1 }),
  cue(T.end + 0.85, 'thump'),
  ...['G4', 'C5', 'E5'].map((note) => cue(T.end + 0.9, 'chime', { note, gain: 0.07 })),
  cue(T.end + 1.1, 'tick'),
];
