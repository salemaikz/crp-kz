// Разбор аргументов scripts/create-admin.ts. Пароль в argv не принимается: он виден в ps и истории shell.
import { isFeatureActive } from '../features';
import type { Env } from '../env';
export type CreateAdminArgs = {
  email: string;
  name: string;
  locale: 'ru' | 'kz';
  promote: boolean;
  /** Личность подтверждена очно (D-039): новый пароль, адрес отмечается подтверждённым. Только с promote. */
  identityConfirmed: boolean;
  ownerOrg?: { name: string; slug: string };
  passwordStdin: boolean;
  allowDemo: boolean;
};

export type ArgsResult = { ok: true; args: CreateAdminArgs } | { ok: false; reason: 'password_in_argv' | 'usage' };

export const CREATE_ADMIN_USAGE =
  'Использование: create-admin.ts --email <e> --name <имя> [--locale ru|kz] [--promote [--identity-confirmed]]\n' +
  '  [--owner-org-name <название> --owner-org-slug <slug>] [--password-stdin] [--allow-demo]\n' +
  '  Пароль спрашивается в приглашении без эха; --password-stdin читает одну строку из stdin.';

const VALUE_FLAGS = new Set(['--email', '--name', '--locale', '--owner-org-name', '--owner-org-slug']);
const BOOL_FLAGS = new Set(['--promote', '--identity-confirmed', '--password-stdin', '--allow-demo']);

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
  // подтверждение личности имеет смысл только при повышении существующего аккаунта
  if (flags.has('--identity-confirmed') && !flags.has('--promote')) return { ok: false, reason: 'usage' };
  return {
    ok: true,
    args: {
      email,
      name,
      locale,
      promote: flags.has('--promote'),
      identityConfirmed: flags.has('--identity-confirmed'),
      ownerOrg: orgName && orgSlug ? { name: orgName, slug: orgSlug } : undefined,
      passwordStdin: flags.has('--password-stdin'),
      allowDemo: flags.has('--allow-demo'),
    },
  };
}

/** Сообщение при неподтверждённом адресе (код выхода 3). Совет про письмо — только если такие функции включены. */
export function unverifiedMessage(env: Env = process.env): string {
  let text =
    'Email пользователя не подтверждён: аккаунт мог завести не сотрудник. Если сотрудник рядом и лично подтвердил, ' +
    'что адрес и ящик его, повторите с --promote --identity-confirmed: он введёт новый пароль, все сессии аккаунта ' +
    'закроются, адрес будет отмечен подтверждённым.';
  if (isFeatureActive('EMAIL_VERIFY', env) || isFeatureActive('PASSWORD_RESET', env)) {
    text += ' Либо пусть сотрудник подтвердит адрес письмом или восстановлением пароля и повторите --promote.';
  }
  return text;
}
