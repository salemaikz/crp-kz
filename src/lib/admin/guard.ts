// Проверка прав на уровне функций: каждая админская функция первым аргументом получает актора.
// Роль проверяется и по переданному объекту, и по БД (актор мог быть понижен после создания сессии).
import { getDb } from '../db';
import { AdminError } from './errors';

export type Actor = { id: string; role: string };

/** Бросает FORBIDDEN, если актор — не администратор. */
export async function assertAdmin(actor: Actor | null | undefined): Promise<Actor> {
  if (!actor || actor.role !== 'admin') throw new AdminError('FORBIDDEN');
  const db = await getDb();
  const [row] = await db.sql<{ role: string }>`SELECT role FROM users WHERE id = ${actor.id}`;
  if (row?.role !== 'admin') throw new AdminError('FORBIDDEN');
  return actor;
}
