// «Где теряются заявки», версия 2. Хук на тёмном: одна точка и три фразы. Точка взрывается
// тысячей заявок, сквозь неё раскрывается доска. Камера едет за заявками с этапа на этап:
// потерянные падают, дошедшие перелетают. Общий план, каскад улучшения дозвона, наезд на итог.
import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { body, C, display, IN, IN_OUT, OUT, POP } from '../brand';
import { clamp, Counter, EndCard, Roll } from '../parts';
import { BEFORE, CAMERA, FPS, HEADINGS, HOOK, LABELS, RATE_AFTER, RATES, T } from './timeline';
import { countAt, DOTS, type Dot, FALL, FALLS, GRAVITY, ORIGIN, pileTop, R, STATION, type Tone } from './world';

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

// Камера между ключами: центр — линейно, масштаб — в логарифме, чтобы наезд шёл ровно.
function camera(t: number) {
  let i = 0;
  while (i + 1 < CAMERA.length && CAMERA[i + 1][0] <= t) i++;
  const [t0, x0, y0, s0] = CAMERA[i];
  const next = CAMERA[i + 1];
  if (!next) return { cx: x0, cy: y0, s: s0 };
  const [t1, x1, y1, s1] = next;
  const p = IN_OUT(Math.min(1, (t - t0) / (t1 - t0)));
  return { cx: x0 + (x1 - x0) * p, cy: y0 + (y1 - y0) * p, s: Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * p) };
}

const World: React.FC<{ t: number }> = ({ t }) => (
  <svg width={STATION * 4} height={1080} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
    {DOTS.map((d) => {
      if (t < d.start) return null;
      const p = interpolate(t, [d.start, d.start + d.dur], [0, 1], { ...clamp, easing: d.arc === 0 ? OUT : IN_OUT });
      const x = d.from.x + (d.x - d.from.x) * p;
      const y = d.from.y + (d.y - d.from.y) * p - Math.sin(Math.PI * p) * d.arc;
      // При взрыве точки вырастают на лету: без тёмного сгустка в центре круга.
      const r = d.arc === 0 ? R * Math.min(1, p * 3) : R;
      return <circle key={`${d.station}-${d.x}-${d.y}`} cx={x} cy={y} r={r} fill={toneAt(d.tones, t)} />;
    })}
    {FALLS.map((f, i) => {
      const dt = t - f.start;
      if (dt < 0 || dt > FALL) return null;
      return (
        <circle
          key={`f${i}`}
          cx={f.x + f.vx * dt}
          cy={f.y + f.vy * dt + (GRAVITY * dt * dt) / 2}
          r={R}
          fill={C.red}
          opacity={interpolate(dt, [FALL - 0.4, FALL], [1, 0], clamp)}
        />
      );
    })}
  </svg>
);

// Цифра и подпись этапа — слева на его экране; «−N» — над кучей в момент потерь.
const Stations: React.FC<{ t: number }> = ({ t }) => (
  <>
    {LABELS.map((label, k) => {
      const left = k * STATION + 160;
      const shown = k === 0 ? T.burst + 0.6 : T.steps[k - 1] + 1.8;
      const count = countAt(k, t);
      const rise = (delay: number) => ({
        translate: interpolate(t, [shown + delay, shown + delay + 0.7], ['0px 110%', '0px 0%'], { ...clamp, easing: OUT }),
      });
      return (
        <React.Fragment key={label}>
          <div
            style={{
              ...display,
              position: 'absolute',
              left: left - 10,
              top: 290,
              fontSize: 220,
              color: k === 3 && t >= T.result ? C.redInk : C.ink,
              opacity: count > 0 ? 1 : 0,
            }}
          >
            <Counter value={count} />
          </div>
          <div style={{ ...body, position: 'absolute', left, top: 545, fontSize: 64, fontWeight: 600, color: C.ink, overflow: 'hidden', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            <div style={rise(0)}>{label}</div>
          </div>
          {k > 0 && (
            <div style={{ ...body, position: 'absolute', left, top: 640, fontSize: 40, color: C.ink2, overflow: 'hidden', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
              <div style={rise(0.15)}>{k === 1 ? <Roll t={t} at={T.improve[0]} from={RATES[k]} to={RATE_AFTER} /> : RATES[k]}</div>
            </div>
          )}
        </React.Fragment>
      );
    })}
    {T.steps.map((s, k) => (
      <div
        key={s}
        style={{
          ...display,
          position: 'absolute',
          left: k * STATION + 1560,
          top: pileTop(k, BEFORE[k]) - 120,
          fontSize: 80,
          color: C.redInk,
          opacity: interpolate(t, [s, s + 0.15, s + 1.6, s + 2], [0, 1, 1, 0], clamp),
          scale: interpolate(t, [s, s + 0.35], [0.6, 1], { ...clamp, easing: POP }),
        }}
      >
        −{BEFORE[k] - BEFORE[k + 1]}
      </div>
    ))}
  </>
);

// Хук на тёмном: красная точка и три фразы в ритм; перед взрывом фразы уходят, точка набухает.
const Hook: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ background: C.deep }}>
    {HOOK.map((line, i) => {
      const top = [290, 460, 680][i];
      const at = T.hook[i];
      const out = T.hookOut + i * 0.06;
      const [before, after] = line.accent ? [line.accent, line.text.slice(line.accent.length)] : ['', line.text];
      return (
        <div key={line.text} style={{ ...display, position: 'absolute', left: 160, top, fontSize: line.size, overflow: 'hidden', height: '1.2em' }}>
          <div
            style={{
              color: i === 2 ? C.onNight2 : C.onNight,
              translate: interpolate(t, [at, at + 0.7, out, out + 0.4], ['0px 110%', '0px 0%', '0px 0%', '0px -110%'], {
                ...clamp,
                easing: [OUT, IN_OUT, IN],
              }),
            }}
          >
            {before && <span style={{ color: C.redOnNight }}>{before}</span>}
            {after}
          </div>
        </div>
      );
    })}
    {/* Цифры хука — тоже условный пример: подпись с первой фразы. */}
    <div style={{ ...body, position: 'absolute', left: 160, top: 990, fontSize: 26, color: C.onNight2, opacity: interpolate(t, [T.hook[0], T.hook[0] + 0.5], [0, 1], clamp) }}>
      Пример расчёта
    </div>
    <div
      style={{
        position: 'absolute',
        left: ORIGIN.x - 12,
        top: ORIGIN.y - 12,
        width: 24,
        height: 24,
        borderRadius: 999,
        background: C.red,
        scale: interpolate(t, [T.dot, T.dot + 0.4, T.burst - 0.5, T.burst], [0, 1, 1, 1.8], {
          ...clamp,
          easing: [POP, IN_OUT, IN],
          output: 'perceptual-scale',
        }),
      }}
    />
  </AbsoluteFill>
);

const Headings: React.FC<{ t: number }> = ({ t }) => (
  <div style={{ ...display, position: 'absolute', left: 160, top: 92, fontSize: 64, height: '1.2em', width: 1600, overflow: 'hidden', color: C.ink }}>
    {HEADINGS.map((h, j) => {
      const next = HEADINGS[j + 1]?.from;
      const enter = h.from + 0.6;
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
                    easing: [IN_OUT, IN_OUT, IN_OUT],
                  }),
          }}
        >
          {h.text}
        </div>
      );
    })}
  </div>
);

export const Funnel2: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const { cx, cy, s } = camera(t);
  return (
    <AbsoluteFill style={{ background: C.deep, overflow: 'hidden' }}>
      <Audio src={staticFile('sfx-funnel2.wav')} />
      <Hook t={t} />
      {/* Доска раскрывается кругом из точки хука — одновременно с разлётом заявок. */}
      <AbsoluteFill
        style={{
          clipPath: `circle(${interpolate(t, [T.burst - 0.05, T.burst + 0.8], [0, 1800], { ...clamp, easing: IN_OUT })}px at ${ORIGIN.x}px ${ORIGIN.y}px)`,
          translate: interpolate(t, [T.end, T.end + 0.9], ['0px 0px', '0px -160px'], { ...clamp, easing: IN_OUT }),
        }}
      >
        <AbsoluteFill style={{ background: C.board }} />
        <AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${960 - s * cx}px, ${540 - s * cy}px) scale(${s})` }}>
          <Stations t={t} />
          <World t={t} />
        </AbsoluteFill>
        <Headings t={t} />
        <div style={{ ...body, position: 'absolute', left: 160, top: 990, fontSize: 26, color: C.ink2 }}>Пример расчёта</div>
      </AbsoluteFill>
      <EndCard t={t} at={T.end} />
    </AbsoluteFill>
  );
};

// Проверка сценария: ключи камеры строго по возрастанию, иначе interpolate и камера ломаются.
if (!CAMERA.every((key, i) => i === 0 || key[0] > CAMERA[i - 1][0])) throw new Error('Ключи камеры должны идти по возрастанию времени');
