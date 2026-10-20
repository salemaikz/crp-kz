// Разбор аргументов scripts/create-admin.ts. Пароль в argv не принимается: он виден в ps и истории shell.
export type CreateAdminArgs = {
  email: string;
  name: string;
  locale: 'ru' | 'kz';
  promote: boolean;
  ownerOrg?: { name: string; slug: string };
  passwordStdin: boolean;
  allowDemo: boolean;
};

export type ArgsResult = { ok: true; args: CreateAdminArgs } | { ok: false; reason: 'password_in_argv' | 'usage' };

export const CREATE_ADMIN_USAGE =
  'Использование: create-admin.ts --email <e> --name <имя> [--locale ru|kz] [--promote]\n' +
  '  [--owner-org-name <название> --owner-org-slug <slug>] [--password-stdin] [--allow-demo]\n' +
  '  Пароль спрашивается в приглашении без эха; --password-stdin читает одну строку из stdin.';

const VALUE_FLAGS = new Set(['--email', '--name', '--locale', '--owner-org-name', '--owner-org-slug']);
const BOOL_FLAGS = new Set(['--promote', '--password-stdin', '--allow-demo']);

export function parseCreateAdminArgs(argv: string[]): ArgsResult {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // любой вариант «--password…», кроме --password-stdin, — попытка передать пароль аргументом
    if (/^--pass/i.test(a) && a !== '--password-stdin') return { ok: false, reason: 'password_in_argv' };
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    if (BOOL_FLAGS.has(key) && eq < 0) {
      flags.add(key);
    } else if (VALUE_FLAGS.has(key)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) return { ok: false, reason: 'usage' };
      // значение, похожее на флаг, — пропущенный аргумент; пароль в значении тоже не принимаем
      if (/^--pass/i.test(v) && v !== '--password-stdin') return { ok: false, reason: 'password_in_argv' };
      if (v.startsWith('--')) return { ok: false, reason: 'usage' };
      values.set(key, v);
    } else {
      return { ok: false, reason: 'usage' };
    }
  }
  const email = values.get('--email');
  const name = values.get('--name');
  const locale = values.get('--locale') ?? 'ru';
  if (!email || !name || (locale !== 'ru' && locale !== 'kz')) return { ok: false, reason: 'usage' };
  const orgName = values.get('--owner-org-name');
  const orgSlug = values.get('--owner-org-slug');
  if (Boolean(orgName) !== Boolean(orgSlug)) return { ok: false, reason: 'usage' };
  return {
    ok: true,
    args: {
      email,
      name,
      locale,
      promote: flags.has('--promote'),
      ownerOrg: orgName && orgSlug ? { name: orgName, slug: orgSlug } : undefined,
      passwordStdin: flags.has('--password-stdin'),
      allowDemo: flags.has('--allow-demo'),
    },
  };
}
