// Снимок СХЕМЫ демо-базы PGlite (только миграции, без сида) → .demo/pglite-snapshot.tar.gz.
// Сид идёт в рантайме, поэтому даты демо всегда свежие. Запускается из scripts/prebuild.mjs;
// при ручном запуске условие проверяется здесь: DEMO_MODE=1, либо VERCEL=1 без DATABASE_URL.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), '.demo', 'pglite-snapshot.tar.gz');

async function main() {
  const hasUrl = !!process.env.DATABASE_URL?.trim();
  if (hasUrl) return console.log('demo-snapshot: задан DATABASE_URL, пропуск');
  if (process.env.DEMO_MODE?.trim() !== '1' && process.env.VERCEL !== '1') {
    return console.log('demo-snapshot: не демо-сборка, пропуск');
  }
  // Тяжёлые импорты — только после проверки окружения
  const { migrate } = await import('../src/lib/db/migrate');
  const { openPglite, wrapPglite } = await import('../src/lib/db/pglite');
  const t0 = Date.now();
  const pg = await openPglite();
  const db = wrapPglite(pg);
  try {
    await migrate(db);
    const buf = Buffer.from(await (await pg.dumpDataDir('gzip')).arrayBuffer());
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, buf);
    console.log(`demo-snapshot: ${(buf.length / 1024 / 1024).toFixed(1)} МБ за ${((Date.now() - t0) / 1000).toFixed(1)} с → .demo/pglite-snapshot.tar.gz`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
