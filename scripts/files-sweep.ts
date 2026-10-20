// npm run files:sweep [-- --dry-run] — подметание файлов (крон, ежедневно).
// Работает при выключенном флаге UPLOADS (К-11): только удаляет, удаление защищено проверкой ссылок.
// Без хранилища (STORAGE_DIR не задан или некорректен) — сообщение и код 0. В лог — счётчики, без имён.
import { openScriptDb } from '../src/lib/db';
import { sweepOrphanFiles, sweepStrayObjects, sweepTemp } from '../src/lib/files/sweep';
import { storageConfig } from '../src/lib/storage/config';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  if (args.some((a) => a !== '--dry-run')) {
    console.error('Использование: files-sweep.ts [--dry-run]');
    return 1;
  }

  const close = await openScriptDb();
  try {
    const cfg = storageConfig();
    if (!cfg.ok) {
      console.log(`Хранилище файлов недоступно (${cfg.reason}), подметать нечего.`);
      return 0;
    }
    const orphans = await sweepOrphanFiles({ dryRun });
    const stray = await sweepStrayObjects({ dryRun });
    const temp = dryRun ? 0 : await sweepTemp();
    console.log(
      `${dryRun ? 'Пробный прогон. ' : ''}Неиспользуемых файлов: ${orphans.deleted.length}, ` +
        `бесхозных объектов: ${stray.removed.length}, временных файлов: ${temp}.`,
    );
    if (orphans.objectErrors.length > 0) {
      console.error(`Не удалось удалить объекты: ${orphans.objectErrors.length}; уберёт следующий прогон.`);
    }
    return 0;
  } finally {
    await close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
