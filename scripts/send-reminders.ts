// npm run reminders:send — формирование напоминаний о сроках (крон, 09:00–19:00 по Астане). mail §3.5, PLAN §2.5.
// Флаг REMINDERS выключен — сообщение и код 0. В лог — только счётчики.
import { openScriptDb } from '../src/lib/db';
import { planReminders } from '../src/lib/reminders';

async function main(): Promise<number> {
  const close = await openScriptDb();
  try {
    const r = await planReminders({ actorId: null });
    if (r.disabled) {
      console.log('Напоминания выключены (REMINDERS), ничего не сделано.');
      return 0;
    }
    console.log(`Поставлено в очередь: срок скоро — ${r.dueSoon}, срок прошёл — ${r.overdue}, сводок руководителям — ${r.digests}.`);
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
