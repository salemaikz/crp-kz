// Демо-аккаунты (BUILD.md §5). Без node-зависимостей: файл можно импортировать и в клиентский код.
// Подписи ролей на кнопках — из сообщений auth.demo.<role>.

export type DemoRole = 'admin' | 'manager' | 'operator' | 'client';
export type DemoAccount = { email: string; name: string; role: DemoRole };

/** Пароль всех демо-пользователей из сида. */
export const DEMO_PASSWORD = 'demo12345';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'admin@crp.demo', name: 'Дана Ахметова', role: 'admin' },
  { email: 'manager@crp.demo', name: 'Ерлан Жумабаев', role: 'manager' },
  { email: 'operator@crp.demo', name: 'Айгерим Сейтказы', role: 'operator' },
  { email: 'client@crp.demo', name: 'Марат Нурланов', role: 'client' },
];

export function isDemoAccountEmail(email: string): boolean {
  return DEMO_ACCOUNTS.some((a) => a.email === email);
}
