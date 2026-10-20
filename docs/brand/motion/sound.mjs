// Звуки анимаций для роликов ЦРП: короткий синтез без сэмплов, внешних библиотек и ИИ.
// Сцена отдаёт список сигналов window.CUES = [{ t: мс, type, ...параметры }], здесь из него
// собирается стерео-WAV той же длины, что ролик. Шум — из генератора с фиксированным зерном,
// поэтому дорожка от запуска к запуску одинаковая.

const RATE = 48000;

// Частота ноты: 'C5', 'G4', 'A5' …
function freq(note) {
  const match = /^([A-G])(\d)$/.exec(note);
  if (!match) throw new Error(`Нота вне шаблона «буква A–G и октава», например C5: ${note}`);
  const [, name, octave] = match;
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name];
  return 440 * 2 ** ((semitone + (Number(octave) + 1) * 12 - 69) / 12);
}

function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

// Каждый голос пишет в моно-буфер с позиции start (в сэмплах).
const voices = {
  // Короткий мягкий щелчок: синус с быстрым спадом высоты и громкости.
  tick(out, start, { freq: f = 1800, gain = 0.1 }) {
    let phase = 0;
    for (let i = 0; i < RATE * 0.06; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * f * (1 - 0.3 * Math.min(t / 0.03, 1))) / RATE;
      out[start + i] += Math.sin(phase) * Math.min(t / 0.001, 1) * Math.exp(-t / 0.012) * gain;
    }
  },
  // Нота «маримбы»: основной тон и четвёртая гармоника, которая гаснет быстрее.
  note(out, start, { note = 'C5', gain = 0.2, decay = 0.35 }) {
    const f = freq(note);
    for (let i = 0; i < RATE * decay * 5; i++) {
      const t = i / RATE;
      const attack = Math.min(t / 0.004, 1);
      const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay);
      const bright = 0.25 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t / (decay / 5));
      out[start + i] += (body + bright) * attack * gain;
    }
  },
  // Колокольчик: негармонические обертоны с разной длиной.
  chime(out, start, { note = 'C6', gain = 0.16 }) {
    const f = freq(note);
    const partials = [[1, 1, 1.6], [2, 0.45, 0.9], [2.76, 0.3, 0.6], [5.4, 0.15, 0.25]];
    for (let i = 0; i < RATE * 3; i++) {
      const t = i / RATE;
      let s = 0;
      for (const [ratio, amp, decay] of partials) s += amp * Math.sin(2 * Math.PI * f * ratio * t) * Math.exp(-t / decay);
      out[start + i] += s * Math.min(t / 0.002, 1) * gain;
    }
  },
  // «Вжух»: шум через полосовой фильтр, центр которого плавно едет от from к to.
  whoosh(out, start, { dur = 600, from = 500, to = 2500, gain = 0.08 }, seed) {
    const rnd = noise(seed);
    const n = Math.round((RATE * dur) / 1000);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const f = from * (to / from) ** p;
      const w = (2 * Math.PI * f) / RATE;
      const alpha = Math.sin(w) / (2 * 1.4);
      const a0 = 1 + alpha;
      const x = rnd();
      const y = ((alpha * x - alpha * x2) - (-2 * Math.cos(w)) * y1 - (1 - alpha) * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[start + i] += y * Math.sin(Math.PI * p) ** 2 * gain * 3;
    }
  },
  // Мягкий низкий удар: синус, который падает от 120 до 50 Гц.
  thump(out, start, { gain = 0.4 }) {
    let phase = 0;
    for (let i = 0; i < RATE * 0.6; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * (50 + 70 * Math.exp(-t / 0.05))) / RATE;
      out[start + i] += Math.sin(phase) * Math.min(t / 0.003, 1) * Math.exp(-t / 0.14) * gain;
    }
  },
};

// Небольшая комната (схема Шрёдера): гребенчатые фильтры с затуханием и два фазовращателя (all-pass).
// Задержки у левого и правого канала чуть разные — звук получается объёмным, но не гулким.
function room(dry, offset) {
  const out = new Float32Array(dry.length);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round(((ms + offset) * RATE) / 1000);
    const buf = new Float32Array(d);
    let k = 0, low = 0;
    for (let i = 0; i < dry.length; i++) {
      const y = buf[k];
      low = y * 0.7 + low * 0.3;
      buf[k] = dry[i] + low * 0.74;
      out[i] += y / 4;
      k = (k + 1) % d;
    }
  }
  for (const ms of [5, 1.7]) {
    const d = Math.round((ms * RATE) / 1000);
    const buf = new Float32Array(d);
    let k = 0;
    for (let i = 0; i < out.length; i++) {
      const v = buf[k];
      const w = out[i] + v * 0.5;
      buf[k] = w;
      out[i] = v - w * 0.5;
      k = (k + 1) % d;
    }
  }
  return out;
}

// Возвращает WAV (PCM 16 бит, стерео, 48 кГц) длиной durationMs.
export function renderAudio(cues, durationMs) {
  const length = Math.round((RATE * durationMs) / 1000);
  const tail = RATE * 3; // хвосты звуков в конце не должны выйти за буфер
  const dry = new Float32Array(length + tail);
  cues.forEach((cue, i) => {
    const voice = voices[cue.type];
    if (!voice) throw new Error(`Неизвестный звук: ${cue.type}`);
    if (!(cue.t >= 0 && cue.t <= durationMs)) throw new Error(`Звук вне ролика: ${cue.type} на ${cue.t} мс`);
    voice(dry, Math.round((RATE * cue.t) / 1000), cue, i + 1);
  });

  const wet = [room(dry, 0), room(dry, 2.3)];
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    left[i] = dry[i] + wet[0][i] * 0.35;
    right[i] = dry[i] + wet[1][i] * 0.35;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // Нормализация по пику: самый громкий момент — −3 дБ, без перегруза.
  const gain = peak > 0 ? 0.708 / peak : 1;

  const wav = Buffer.alloc(44 + length * 4);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + length * 4, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(length * 4, 40);
  for (let i = 0; i < length; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), 46 + i * 4);
  }
  return wav;
}
