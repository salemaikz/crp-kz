// prebuild: в демо-сборке готовит снимок схемы PGlite; иначе ничего не делает.
// Условие должно совпадать с isDemo() в src/lib/env.ts (D-016, D-019): DEMO_MODE=1,
// либо VERCEL=1 без DATABASE_URL. Чистый Node: tsx нужен только в демо-ветке.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const env = (name) => process.env[name]?.trim() || undefined;

if (env('DATABASE_URL')) {
  console.log('demo-snapshot: задан DATABASE_URL, пропуск');
} else if (env('DEMO_MODE') === '1' || process.env.VERCEL === '1') {
  // локальный tsx, без скачивания из реестра
  const tsx = process.platform === 'win32' ? 'node_modules/.bin/tsx.cmd' : 'node_modules/.bin/tsx';
  if (!existsSync(tsx)) {
    console.error('demo-snapshot: нужны devDependencies для демо-сборки (npm install без --omit=dev)');
    process.exit(1);
  }
  const r = spawnSync(tsx, ['scripts/build-demo-snapshot.ts'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.log('demo-snapshot: не демо-сборка, пропуск');
}
