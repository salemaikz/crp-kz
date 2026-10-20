// npm run mail:worker — воркер очереди писем (крон, раз в минуту). Нормативно: mail §3.5, PLAN §2.5.
// Транспорт outbox (демо, почта не подключена): письма не отправляются, скрипт выходит с кодом 0.
// Очистка старых писем и токенов идёт и при outbox. В лог — только счётчики, без адресов и текстов.
import { IN_MEMORY_MESSAGE, openScriptDb } from '../src/lib/db';
import { resolveTransport } from '../src/lib/mail/transport';
import { deliverPending, purgeMail, type DeliverResult } from '../src/lib/mail/worker';

/** Пачки подряд, пока есть что отправлять, но не дольше этого времени: следующий запуск крона подхватит остальное. */
const RUN_LIMIT_MS = 50_000;
const OUTBOX_MESSAGE = 'Транспорт outbox: письма не отправляются.';

async function main(): Promise<number> {
  const transport = await resolveTransport();
  // БД в памяти скрипту бесполезна (openScriptDb откажет): для outbox это не ошибка, чистить нечего
  const inMemory = !process.env.DATABASE_URL?.trim() && !process.env.PGLITE_DIR?.trim();
  if (!transport && inMemory) {
    console.log(`${OUTBOX_MESSAGE} ${IN_MEMORY_MESSAGE}`);
    return 0;
  }

  const close = await openScriptDb();
  try {
    const purged = await purgeMail();
    console.log(`Очистка: писем ${purged.letters}, токенов ${purged.tokens}, секретов ${purged.secrets}.`);
    if (!transport) {
      console.log(OUTBOX_MESSAGE);
      return 0;
    }

    const total: DeliverResult = { sent: 0, retried: 0, failed: 0, cancelled: 0 };
    const startedAt = Date.now();
    while (Date.now() - startedAt < RUN_LIMIT_MS) {
      const r = await deliverPending({ transport });
      total.sent += r.sent;
      total.retried += r.retried;
      total.failed += r.failed;
      total.cancelled += r.cancelled;
      if (r.sent + r.retried + r.failed + r.cancelled === 0) break;
    }
    console.log(`Отправлено ${total.sent}, повторов ${total.retried}, отказов ${total.failed}, отменено ${total.cancelled}.`);
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
