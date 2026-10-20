// npm run admin:create -- --email <e> --name <имя> [...] — первый администратор (docs/lms/design/ops.md §3.16).
// Пароль вводится в приглашении без эха или одной строкой из stdin (--password-stdin); в argv его нет.
// Коды выхода: 0 — готово, 2 — неверные данные или демо без --allow-demo, 3 — уже есть / не найден, 1 — прочее.
import { getDb, openScriptDb } from '../src/lib/db';
import { isDemo } from '../src/lib/env';
import { createAdmin, CreateAdminError, type CreateAdminErrorCode } from '../src/lib/ops/createAdmin';
import { CREATE_ADMIN_USAGE, parseCreateAdminArgs } from '../src/lib/ops/createAdminArgs';
import { promptHidden, readLine } from '../src/lib/ops/passwordInput';

const MESSAGES: Record<CreateAdminErrorCode, string> = {
  validation: 'Неверные данные: проверьте email, имя и название организации.',
  weak_password: 'Пароль слабый: нужно не меньше 12 символов (и не больше 72 байт).',
  exists: 'Пользователь с таким email уже есть. Чтобы выдать ему роль admin, добавьте --promote.',
  not_found: 'Пользователь с таким email не найден: --promote повышает только существующих.',
  bad_slug: 'Неверный или занятый slug организации: 2–40 символов a-z, 0-9 и дефис.',
};
const EXIT: Record<CreateAdminErrorCode, number> = {
  validation: 2,
  weak_password: 2,
  bad_slug: 2,
  exists: 3,
  not_found: 3,
};

async function readPassword(fromStdin: boolean): Promise<string | null> {
  if (fromStdin) return readLine(process.stdin);
  const first = await promptHidden('Пароль: ');
  const second = await promptHidden('Повторите пароль: ');
  if (first !== second) {
    console.error('Пароли не совпадают.');
    return null;
  }
  return first;
}

async function main(): Promise<number> {
  const parsed = parseCreateAdminArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(
      parsed.reason === 'password_in_argv'
        ? 'Пароль в аргументах не принимается: он виден в ps и истории shell. Введите его в приглашении или через --password-stdin.'
        : CREATE_ADMIN_USAGE,
    );
    return 2;
  }
  const { args } = parsed;
  if (isDemo() && !args.allowDemo) {
    console.error('Демо-режим: администратор уже есть в сиде. Для проверки скрипта добавьте --allow-demo.');
    return 2;
  }

  let password: string | undefined;
  if (!args.promote) {
    const p = await readPassword(args.passwordStdin);
    if (p === null) return 2;
    password = p;
  }

  const close = await openScriptDb();
  try {
    const db = await getDb();
    const r = await createAdmin(db, {
      email: args.email,
      name: args.name,
      locale: args.locale,
      password,
      promote: args.promote,
      ownerOrg: args.ownerOrg,
    });
    // email не печатаем повторно: в журнале терминала и логе ему не место
    console.log(`${r.created ? 'Администратор создан' : r.promoted ? 'Роль admin выдана' : 'Пользователь уже администратор'}: ${r.userId}`);
    if (r.orgId) console.log(`Организация-владелец: ${r.orgId}${r.orgCreated ? ' (создана)' : ''}`);
    return 0;
  } catch (e) {
    if (e instanceof CreateAdminError) {
      console.error(MESSAGES[e.code]);
      return EXIT[e.code];
    }
    throw e;
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
