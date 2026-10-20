// Разрешение на сид демо-данных (getDb/prepareDb и скрипт db:seed). Без обращений к БД. Нормативно: D-040.
import { isDemo, type Env } from '../env';

/**
 * Можно ли сеять демо-данные. Демо-режим либо явный SEED_DEMO=1 вне production.
 * Демо-учётки имеют публичный пароль: в production без DEMO_MODE=1 их в настоящую базу не пишем.
 */
export function seedPermitted(env: Env = process.env): boolean {
  return isDemo(env) || (env.SEED_DEMO?.trim() === '1' && env.NODE_ENV !== 'production');
}

/**
 * Текст отказа или null, если сид разрешён.
 * Текст не содержит пароля, адреса БД и значений переменных.
 */
export function seedRefusal(env: Env = process.env): string | null {
  if (seedPermitted(env)) return null;
  if (env.SEED_DEMO?.trim() === '1') {
    return (
      'SEED_DEMO=1 в production не действует без DEMO_MODE=1: демо-учётки с публичным паролем в боевую базу не пишутся. ' +
      'Администратора создаёт admin:create.'
    );
  }
  return (
    'db:seed отказался работать: это не демо-окружение. Сид создаёт учётки с публичным паролем. ' +
    'Для демо-базы задайте SEED_DEMO=1 или DEMO_MODE=1. Администратора настоящей базы создаёт admin:create.'
  );
}
