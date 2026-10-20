// npm run ops:preflight [-- --db] — проверка окружения production перед выкладкой (ops.md §3.15).
// Вывод: «ERROR <код>» / «WARN <код>» по строке, без значений переменных. Код выхода 1, если есть ERROR.
// В демо намеренно выдаёт ERROR demo_mode_set: скрипт только для production.
import { openDriver } from '../src/lib/db';
import { checkProductionDb, checkProductionEnv, formatIssues, hasErrors, type PreflightIssue } from '../src/lib/ops/preflight';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--db')) {
    console.error('Использование: ops-preflight.ts [--db]');
    return 1;
  }
  const issues: PreflightIssue[] = checkProductionEnv(process.env);

  if (args.includes('--db')) {
    // Не openScriptDb: проверка идёт ДО миграций выкладки, а prepareDb при ненакатанных миграциях
    // падает. Нужен только чтение, поэтому берём «голый» драйвер.
    if (hasErrors(issues.filter((i) => i.code.startsWith('database_url') || i.code === 'pglite_dir_set'))) {
      console.log('SKIP db_checks');
    } else {
      const db = await openDriver();
      try {
        issues.push(...(await checkProductionDb(db)));
      } finally {
        await db.close();
      }
    }
  }

  for (const line of formatIssues(issues)) console.log(line);
  return hasErrors(issues) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    // Текст ошибки подключения может содержать хост: наружу — только факт
    console.error(`ERROR db_unreachable${e instanceof Error && e.name ? ` (${e.name})` : ''}`);
    process.exit(1);
  },
);
