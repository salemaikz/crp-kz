// Ролик «Где теряются заявки»: тысяча точек-заявок проходит воронку из четырёх этапов,
// затем улучшается один этап — дозвон — и каскад показывает, сколько это даёт покупок.
import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { body, C, display, IN_OUT, OUT, POP } from './brand';
import { clamp, Counter, EndCard, Roll } from './parts';
import { BOTTOM, COLS, countAt, DOTS, type Dot, FLIGHT, GAP, LEFTS, PILE_WIDTH, POP_TIME, R, type Tone } from './dots';
import { BEFORE, FPS, HEADINGS, RATE_AFTER, RATES, STAGES, T } from './timeline';

// Цвета точек в RGBA: потерянные — приглушённый --line-strong, чтобы потери были видны, но не спорили с итогом.
const TONES: Record<Tone, [number, number, number, number]> = {
  ink: [20, 22, 27, 1],
  red: [227, 30, 36, 1],
  gray: [140, 145, 154, 0.4],
};
const FADE = 0.25;
function toneAt(tones: Dot['tones'], t: number) {
  let j = 0;
  while (j + 1 < tones.length && tones[j + 1].t <= t) j++;
  const now = TONES[tones[j].tone];
  if (j === 0 || t - tones[j].t >= FADE) return `rgba(${now.join(',')})`;
  const was = TONES[tones[j - 1].tone];
  const p = (t - tones[j].t) / FADE;
  return `rgba(${now.map((v, i) => was[i] + (v - was[i]) * p).join(',')})`;
}

const Dots: React.FC<{ t: number }> = ({ t }) => (
  <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
    {DOTS.map((d) => {
      if (t < d.start) return null;
      const fill = toneAt(d.tones, t);
      if (!d.from) {
        const r = R * interpolate(t, [d.start, d.start + POP_TIME], [0, 1], { ...clamp, easing: POP });
        return <circle key={`${d.pile}-${d.x}-${d.y}`} cx={d.x} cy={d.y} r={r} fill={fill} />;
      }
      // Перелёт по дуге: точка подпрыгивает и садится на то же место в следующей куче.
      const p = interpolate(t, [d.start, d.start + FLIGHT], [0, 1], { ...clamp, easing: IN_OUT });
      const x = d.from.x + (d.x - d.from.x) * p;
      const y = d.from.y + (d.y - d.from.y) * p - Math.sin(Math.PI * p) * d.arc;
      return <circle key={`${d.pile}-${d.x}-${d.y}`} cx={x} cy={y} r={R} fill={fill} />;
    })}
  </svg>
);

// Подписи и счётчики куч — внутри камеры, вместе с точками.
const Piles: React.FC<{ t: number }> = ({ t }) => (
  <>
    {STAGES.map((name, k) => {
      const shown = k === 0 ? T.fill : T.steps[k - 1] + 0.6;
      const count = countAt(k, t);
      const top = BOTTOM - (count / COLS) * GAP;
      const appear = (delay: number) => ({
        opacity: interpolate(t, [shown + delay, shown + delay + 0.6], [0, 1], clamp),
        translate: interpolate(t, [shown + delay, shown + delay + 0.6], ['0px 16px', '0px 0px'], { ...clamp, easing: OUT }),
      });
      const isResult = k === 3;
      return (
        <React.Fragment key={name}>
          <div
            style={{
              ...display,
              position: 'absolute',
              left: LEFTS[k] - 6,
              top: top - 84,
              fontSize: 56,
              color: isResult && t >= T.result ? C.redInk : C.ink,
              opacity: count > 0 ? 1 : 0,
            }}
          >
            <Counter value={count} />
          </div>
          <div style={{ ...body, position: 'absolute', left: LEFTS[k], top: 840, fontSize: 32, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', ...appear(0) }}>
            {name}
          </div>
          {k > 0 && (
            <div style={{ ...body, position: 'absolute', left: LEFTS[k], top: 886, fontSize: 26, color: C.ink2, whiteSpace: 'nowrap', ...appear(0.15) }}>
              {k === 1 ? <Roll t={t} at={T.improve[0]} from={RATES[k]} to={RATE_AFTER} /> : RATES[k]}
            </div>
          )}
        </React.Fragment>
      );
    })}
    {T.steps.map((s, k) => {
      const lost = BEFORE[k] - BEFORE[k + 1];
      return (
        <div
          key={s}
          style={{
            ...body,
            position: 'absolute',
            left: LEFTS[k] + PILE_WIDTH + 16,
            top: BOTTOM - (BEFORE[k] / COLS) * GAP - 8,
            fontSize: 30,
            fontWeight: 600,
            color: C.redInk,
            opacity: interpolate(t, [s + 0.1, s + 0.5, s + 2.2, s + 2.8], [0, 1, 1, 0], clamp),
            translate: interpolate(t, [s + 0.1, s + 2.8], ['0px 12px', '0px -24px'], { ...clamp, easing: OUT }),
          }}
        >
          −{lost}
        </div>
      );
    })}
  </>
);

// Заголовок: в заставке крупно по центру, затем уменьшается в угол; дальше реплики сменяют друг друга.
const Heading: React.FC<{ t: number }> = ({ t }) => (
  <div
    style={{
      ...display,
      position: 'absolute',
      left: 160,
      top: interpolate(t, [T.headingShrink, T.headingShrink + 0.9], [462, 92], { ...clamp, easing: IN_OUT }),
      fontSize: interpolate(t, [T.headingShrink, T.headingShrink + 0.9], [150, 64], { ...clamp, easing: IN_OUT }),
      height: '1.2em',
      width: 1600,
      overflow: 'hidden',
      color: C.ink,
    }}
  >
    {HEADINGS.map((h, j) => {
      const next = HEADINGS[j + 1]?.from;
      const first = j === 0;
      const enter = h.from + (first ? 0.9 : 0.6);
      return (
        <div
          key={h.text}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            translate:
              next === undefined
                ? interpolate(t, [h.from, enter], ['0px 110%', '0px 0%'], { ...clamp, easing: IN_OUT })
                : interpolate(t, [h.from, enter, next, next + 0.6], ['0px 110%', '0px 0%', '0px 0%', '0px -110%'], {
                    ...clamp,
                    easing: [first ? OUT : IN_OUT, IN_OUT, IN_OUT],
                  }),
          }}
        >
          {h.text}
        </div>
      );
    })}
  </div>
);

export const Funnel: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  // Камера: приближение к первым кучам, где теряется больше всего, и обратно. Масштаб такой,
  // чтобы счётчик первой кучи не заходил под заголовок, а третья куча оставалась в кадре.
  const keys = [T.zoomIn, T.zoomIn + 1, T.zoomOut, T.zoomOut + 1];
  const cam = (a: number, b: number) => interpolate(t, keys, [a, b, b, a], { ...clamp, easing: [IN_OUT, IN_OUT, IN_OUT] });
  const s = cam(1, 1.2);
  const cx = cam(960, 620);
  const cy = cam(540, 530);
  return (
    <AbsoluteFill style={{ background: C.board, overflow: 'hidden' }}>
      <Audio src={staticFile('sfx-funnel.wav')} />
      <AbsoluteFill style={{ translate: interpolate(t, [T.end, T.end + 0.9], ['0px 0px', '0px -160px'], { ...clamp, easing: IN_OUT }) }}>
        <AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${960 - s * cx}px, ${540 - s * cy}px) scale(${s})` }}>
          {/* Счётчики под точками: перелетающие точки проходят поверх цифр. */}
          <Piles t={t} />
          <Dots t={t} />
        </AbsoluteFill>
        <Heading t={t} />
        <div
          style={{
            ...body,
            position: 'absolute',
            left: 160,
            top: 990,
            fontSize: 26,
            color: C.ink2,
            // Подпись — вместе с первыми точками: цифры не должны появиться без неё.
            opacity: interpolate(t, [T.fill - 0.2, T.fill + 0.3], [0, 1], { ...clamp, easing: OUT }),
          }}
        >
          Пример расчёта
        </div>
      </AbsoluteFill>
      <EndCard t={t} at={T.end} />
    </AbsoluteFill>
  );
};
