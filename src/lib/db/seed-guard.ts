// Разрешение на сид демо-данных из скрипта db:seed. Без обращений к БД: проверяется до её открытия.
import { isDemo } from '../env';

/**
 * Текст отказа или null, если сид разрешён: демо-режим или явный SEED_DEMO=1.
 * Демо-учётки имеют публичный пароль, в настоящую базу их сеять нельзя.
 * Текст не содержит пароля и адреса БД.
 */
export function seedRefusal(env: Record<string, string | undefined> = process.env): string | null {
  if (env.SEED_DEMO?.trim() === '1' || isDemo(env)) return null;
  return (
    'db:seed отказался работать: это не демо-окружение. Сид создаёт учётки с публичным паролем. ' +
    'Для демо-базы задайте SEED_DEMO=1 или DEMO_MODE=1. Администратора настоящей базы создаёт admin:create.'
  );
}
