// Карточка пользователя в админке: отправка ссылки для смены пароля и блок «Согласия».
// Каждая функция сама проверяет администратора и флаг: тестируются без Next, вызываются из действий и страницы.
import type { Locale } from '../content/types';
import { getDb, now } from '../db';
import { requestPasswordReset, type PasswordResetRequestResult } from '../auth/recovery';
import { isFeatureActive } from '../features';
import { listUserConsents, type ConsentView } from '../legal/consents';
import { AdminError } from './errors';
import { assertAdmin, type Actor } from './guard';

/**
 * Отправить пользователю ссылку для смены пароля. Журнал `user.password_reset_link` пишется только
 * когда письмо действительно встало в очередь: ложной записи при демо-аккаунте, лимите или недоступной
 * очереди нет. Причину отказа возвращаем администратору (публичная форма её скрывает).
 */
export async function sendResetLink(actor: Actor, userId: string): Promise<PasswordResetRequestResult> {
  await assertAdmin(actor);
  if (!isFeatureActive('PASSWORD_RESET')) throw new AdminError('FEATURE_DISABLED');
  const db = await getDb();
  const [user] = await db.sql<{ id: string; email: string; locale: Locale }>`
    SELECT id, email, locale FROM users WHERE id = ${userId}`;
  if (!user) throw new AdminError('NOT_FOUND');

  const t = now();
  // requestPasswordReset сам пишет user.password_reset_request и (auditLink) user.password_reset_link
  // в одной транзакции с письмом
  return requestPasswordReset({ email: user.email, locale: user.locale, actorId: actor.id, auditLink: true, nowMs: t });
}

/**
 * Согласия пользователя для карточки: только администратору и только при активном LEGAL.
 * Выключен LEGAL — пустой список (блок не показывается). Строки без хэша текста — легаси-режим
 * (редакция до публикации документов), их помечает интерфейс.
 */
export async function getUserConsents(actor: Actor, userId: string): Promise<ConsentView[]> {
  await assertAdmin(actor);
  if (!isFeatureActive('LEGAL')) return [];
  return listUserConsents(userId);
}
