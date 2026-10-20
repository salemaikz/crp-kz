// PM2: один воркер в режиме cluster (D-027). reload поднимает новый воркер на том же порту и только
// потом гасит старый, а лимиты частоты живут в памяти одного процесса (D-018, D-022): при N воркерах
// лимит вырос бы в N раз. Секретов здесь нет: Next читает .env.production (симлинк на файл в /etc/crp).
// PM2 читает конфиг как CommonJS: require здесь единственный вариант.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

// __dirname — реальный путь релиза (<корень>/releases/<id>/deploy): корень установки на три уровня выше.
const root = path.resolve(__dirname, '..', '..', '..');
const inst = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'instance.json'), 'utf8'));

// Идентификатор релиза нужен рантайму Next для сверки версии клиента (NEXT_DEPLOYMENT_ID при сборке).
let releaseId;
try {
  releaseId = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'RELEASE.json'), 'utf8')).id;
} catch {
  releaseId = undefined;
}

module.exports = {
  apps: [
    {
      name: inst.name, // 'crp' или 'crp-staging'
      cwd: path.join(root, 'current'), // симлинк: новый воркер стартует в новом релизе
      script: 'node_modules/next/dist/bin/next',
      args: `start -H 127.0.0.1 -p ${inst.port}`, // наружу порт не открыт, снаружи только nginx
      exec_mode: 'cluster',
      instances: 1,
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        ...(releaseId ? { NEXT_DEPLOYMENT_ID: releaseId } : {}),
      },
      listen_timeout: 20000,
      kill_timeout: 20000, // дренаж запросов при reload
      max_memory_restart: '1200M',
      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 500,
      out_file: `/var/log/crp/${inst.name}-out.log`,
      error_file: `/var/log/crp/${inst.name}-err.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
