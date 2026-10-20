// Рендер motion-роликов ЦРП в MP4: кадры снимает Chromium (Playwright), звук синтезирует
// sound.mjs по списку сигналов сцены, склеивает ffmpeg.
// Сцена — папка рядом с этим файлом с index.html, который отдаёт window.ready, DURATION,
// seek(ms) и, если нужен звук, CUES.
// Запуск из корня репозитория:
//   node docs/brand/motion/render.mjs <сцена> [--fps 60] [--out путь.mp4] [--frames 0,4000,9000]
//   node docs/brand/motion/render.mjs <сцена> --serve [--port 8080]
// --frames — вместо видео сохранить PNG стоп-кадров (мс) во временную папку, для проверки.
// --serve — только поднять локальный сервер и напечатать адрес превью.
// Нужны ffmpeg с libx264 в PATH и Chromium для Playwright (npx playwright install chromium).

import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, posix, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { renderAudio } from './sound.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
// Сервер отдаёт только то, что нужно сценам: бренд и шрифты, не весь репозиторий.
const allowed = ['/docs/brand/', '/assets/fonts/'];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const scene = args[0];
if (!/^[a-z0-9-]+$/.test(scene ?? '') || !existsSync(join(here, scene, 'index.html'))) {
  console.error('Укажите сцену — папку с index.html рядом со скриптом: node docs/brand/motion/render.mjs revenue');
  process.exit(1);
}
const fps = Number(opt('fps', 60));
const out = resolve(opt('out', join(here, scene, `crp-${scene}-1920x1080.mp4`)));
const stills = opt('frames', null)?.split(',').map(Number);

// Шрифты по file:// Chromium не грузит (CORS), поэтому сцену отдаёт локальный сервер.
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  let path;
  try {
    path = posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  } catch {
    return res.writeHead(400).end();
  }
  if (!allowed.some((dir) => path.startsWith(dir))) return res.writeHead(403).end();
  const file = join(root, path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(Number(opt('port', 0)), '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/docs/brand/motion/${scene}/index.html`;

if (args.includes('--serve')) {
  console.log(`Превью: ${base}\nСтоп-кадр: ${base}?t=9000\nОстановить — Ctrl+C`);
} else {
  try {
    await render();
  } finally {
    server.close();
  }
}

async function render() {
  const browser = await chromium.launch();
  let ffmpeg;
  // Видео пишется во временный файл и заменяет готовый ролик только после успешной сборки:
  // прерванный рендер не должен затереть рабочий MP4 обрезанным.
  const part = `${out}.part`;
  const wav = join(tmpdir(), `crp-motion-${scene}-${process.pid}.wav`);
  const cleanup = () => {
    rmSync(part, { force: true });
    rmSync(wav, { force: true });
  };
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    const response = await page.goto(`${base}?render`);
    if (!response?.ok()) throw new Error(`Сцена не открылась: ${response?.status()}`);
    await page.evaluate(() => window.ready);
    if (errors.length) throw errors[0];
    const { duration, cues } = await page.evaluate(() => ({ duration: window.DURATION, cues: window.CUES ?? [] }));
    if (!Number.isFinite(duration)) throw new Error('Сцена не задала window.DURATION');
    const shot = async (ms) => {
      await page.evaluate((t) => window.seek(t), ms);
      return page.screenshot({ type: 'png' });
    };

    if (stills) {
      // Без --out — новая временная папка на каждый запуск: кадры разных прогонов не смешиваются.
      const dir = opt('out', null) ? out.replace(/\.mp4$/, '-frames') : await mkdtemp(join(tmpdir(), `crp-motion-${scene}-`));
      await mkdir(dir, { recursive: true });
      for (const ms of stills) await writeFile(join(dir, `${String(ms).padStart(5, '0')}.png`), await shot(ms));
      console.log(`Кадры: ${dir}`);
      return;
    }

    const audio = cues.length > 0;
    if (audio) await writeFile(wav, renderAudio(cues, duration));

    // Цвет — BT.709, как ждут плееры и соцсети: иначе фирменный красный уходит в оранжевый.
    ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      ...(audio ? ['-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation',
      '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      '-f', 'mp4', part,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, fail) => {
      ffmpeg.on('error', fail);
      ffmpeg.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg: код ${code}`))));
    });
    done.catch(() => {}); // ошибку заберёт await ниже, здесь — только чтобы не было unhandled rejection
    ffmpeg.stdin.on('error', () => {}); // EPIPE, если ffmpeg упал: причина придёт через done

    const frames = Math.round((duration / 1000) * fps);
    for (let f = 0; f < frames; f++) {
      const png = await shot((f * 1000) / fps);
      if (!ffmpeg.stdin.write(png)) {
        await Promise.race([new Promise((ok) => ffmpeg.stdin.once('drain', ok)), done]);
      }
      if (f % fps === 0) process.stdout.write(`\r${f}/${frames}`);
    }
    ffmpeg.stdin.end();
    await done;
    await rename(part, out);
    console.log(`\rГотово: ${out} (${frames} кадров, ${fps} fps${audio ? ', со звуком' : ''})`);
  } finally {
    if (ffmpeg && ffmpeg.exitCode === null) ffmpeg.kill();
    cleanup();
    await browser.close();
  }
}
