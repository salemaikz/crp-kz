// Кнопка «Сформировать напоминания» в админке: проверка прав и флага, затем planReminders.
// Отдельно от server action, чтобы проверять без Next.
import { AdminError } from '../admin/errors';
import { assertAdmin, type Actor } from '../admin/guard';
import { isFeatureActive } from '../features';
import { planReminders } from './plan';

export type RunRemindersResult = { learners: number; digests: number };

/** Только администратор; флаг REMINDERS выключен — FEATURE_DISABLED и никаких записей. */
export async function runRemindersAs(actor: Actor): Promise<RunRemindersResult> {
  await assertAdmin(actor);
  if (!isFeatureActive('REMINDERS')) throw new AdminError('FEATURE_DISABLED');
  const res = await planReminders({ actorId: actor.id });
  if (res.disabled) throw new AdminError('FEATURE_DISABLED');
  return { learners: res.dueSoon + res.overdue, digests: res.digests };
}
