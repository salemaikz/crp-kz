// Сценарий «Где теряются заявки», версия 2: хук на тёмном, камера едет за заявками по этапам,
// общий план и каскад улучшения. Всё в долях бита 120 BPM — движение и звук попадают в ритм.
// Модуль без зависимостей: его читает и композиция, и scripts/prepare.mjs.

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

const BEAT = 0.5;
export const beat = (n: number) => n * BEAT;

// Условный пример: 1 000 заявок → 60% дозвона → 40% на встречу → 25% покупают.
// Во второй половине улучшается только дозвон — до 75%.
export const LABELS = ['заявок', 'дозвонились', 'пришли на встречу', 'купили'];
export const BEFORE = [1000, 600, 240, 60];
export const AFTER = [1000, 750, 300, 75];
export const RATES = ['', '60% заявок', '40% из них', '25% из них'];
export const RATE_AFTER = '75% заявок';

export const T = {
  dot: beat(1),
  // Третья фраза приходит раньше и уходит последней — успевает прочитаться.
  hook: [beat(2), beat(4), beat(5)],
  hookOut: beat(7.2),
  burst: beat(8),
  // Переход k: потерянные краснеют и падают, оставшиеся летят к этапу k + 1, камера — за ними.
  steps: [beat(16), beat(24), beat(32)],
  result: beat(37),
  wide: beat(40),
  summary: beat(42),
  better: beat(46),
  improve: [beat(48), beat(52), beat(55)],
  push: beat(58),
  end: beat(64),
  total: beat(74),
};

// Камера: [время, центр x, центр y, масштаб]. Этап k — экран с центром 960 + 1920·k.
export const CAMERA: [number, number, number, number][] = [
  [0, 960, 540, 1],
  ...T.steps.flatMap((s, k): [number, number, number, number][] => [
    [s + 1, 960 + 1920 * k, 540, 1],
    [s + 2.2, 960 + 1920 * (k + 1), 540, 1],
  ]),
  [T.wide, 6720, 540, 1],
  [T.wide + 1.5, 3840, 540, 0.25],
  [T.push, 3840, 540, 0.25],
  [T.push + 1.2, 6720, 540, 1],
];

export const HOOK = [
  { text: '1 000 заявок.', size: 150 },
  { text: '60 покупок.', size: 150, accent: '60' },
  { text: 'Остальные 940 теряются по пути', size: 56 },
];

export const HEADINGS = [
  { text: 'Из 1 000 заявок — 60 покупок', from: T.summary },
  { text: 'Если дозваниваться до 75% заявок', from: T.better },
  { text: 'Те же 1 000 заявок — 75 покупок вместо 60', from: T.push },
];

export const frames = (seconds: number) => Math.round(seconds * FPS);

// Звук для ../../sound.mjs: t — миллисекунды.
type Cue = { t: number; type: string; [param: string]: number | string };
const cue = (seconds: number, type: string, params: Record<string, number | string> = {}): Cue => ({
  t: Math.round(seconds * 1000),
  type,
  ...params,
});

// Бит: бочка на 1 и 3, хэт на каждую слабую восьмую, бас — тоника на первую долю и короткая нота на четвёртую.
const BASS = ['A1', 'F1', 'C2', 'G1'];
function groove(from: number, to: number, kick = true) {
  const cues: Cue[] = [];
  for (let b = from; b < to; b++) {
    const t = beat(b);
    if (kick && b % 2 === 0) cues.push(cue(t, 'kick', { gain: 0.32 }));
    cues.push(cue(t + BEAT / 2, 'hat'));
    const bar = Math.floor(b / 4);
    if (b % 4 === 0) cues.push(cue(t, 'bass', { note: BASS[bar % 4] }));
    if (b % 4 === 3) cues.push(cue(t, 'bass', { note: BASS[bar % 4], gain: 0.2, decay: 0.2 }));
  }
  return cues;
}

const MOTIF = ['C5', 'E5', 'G5'];

export const CUES: Cue[] = [
  // Хук: одна точка и три фразы в тишине, разгон перед взрывом.
  cue(T.dot, 'note', { note: 'A4', gain: 0.2 }),
  ...T.hook.map((s, i) => cue(s, 'note', { note: ['C5', 'E5', 'A4'][i], gain: 0.16 })),
  ...[4, 5, 6, 7].map((b) => cue(beat(b) + BEAT / 2, 'hat', { gain: 0.02 })),
  cue(beat(6), 'whoosh', { dur: 1000, from: 300, to: 3200, gain: 0.07 }),
  // Взрыв: тысяча точек разлетается по местам.
  cue(T.burst, 'kick', { gain: 0.5 }),
  cue(T.burst, 'thump', { gain: 0.25 }),
  ...Array.from({ length: 14 }, (_, i) => cue(T.burst + 0.05 + i * 0.04, 'tick', { freq: 1400 + i * 80, gain: 0.04 })),
  ...groove(8, 40),
  ...T.steps.flatMap((s, k) => [
    cue(s, 'note', { note: 'E4', gain: 0.14 }),
    cue(s + 0.5, 'whoosh', { dur: 900, from: 2400, to: 300, gain: 0.06 }),
    cue(s + 1, 'whoosh', { dur: 1200, from: 400, to: 2400, gain: 0.06 }),
    cue(s + 2.2, 'note', { note: MOTIF[k] }),
  ]),
  cue(T.result, 'chime', { note: 'C6' }),
  // Общий план: бит уходит, остаётся подложка — пауза перед выводом.
  cue(T.wide, 'whoosh', { dur: 1500, from: 1800, to: 300, gain: 0.07 }),
  cue(T.wide, 'pad', { notes: 'A3 C4 E4', dur: 4000 }),
  cue(T.summary, 'tick'),
  cue(T.wide + 4, 'pad', { notes: 'F3 A3 C4', dur: 4000 }),
  cue(T.better, 'tick'),
  // Каскад: бит возвращается, точки снова в игре — восходящая россыпь и мотив.
  ...groove(48, 64),
  ...Array.from({ length: 8 }, (_, i) => cue(T.improve[0] + i * 0.04, 'tick', { freq: 1600 + i * 150, gain: 0.05 })),
  ...T.improve.map((s, k) => cue(s + 1.2, 'note', { note: ['D5', 'G5', 'A5'][k] })),
  cue(T.improve[2] + 1.5, 'chime', { note: 'C6' }),
  cue(T.push, 'whoosh', { dur: 1200, from: 300, to: 2000, gain: 0.08 }),
  cue(T.push, 'tick'),
  // Финал.
  cue(T.end, 'whoosh', { dur: 900, from: 300, to: 1200, gain: 0.1 }),
  cue(T.end, 'bass', { note: 'A1', decay: 0.8 }),
  cue(T.end + 0.85, 'thump'),
  ...['A4', 'C5', 'E5'].map((note) => cue(T.end + 0.9, 'chime', { note, gain: 0.07 })),
  cue(T.end + 1.1, 'tick'),
];
