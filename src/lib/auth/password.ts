// Пароли: bcryptjs, cost 10, минимум 8 символов. Нормативно: docs/lms/BUILD.md §5.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const BCRYPT_COST = 10;
export const PASSWORD_MIN_LENGTH = 8;

/** Проблема с паролем при регистрации/смене или null. bcrypt учитывает только первые 72 байта. */
export function passwordProblem(password: string): 'weak_password' | 'validation' | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'weak_password';
  if (bcrypt.truncates(password)) return 'validation';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

let dummyHash: Promise<string> | null = null;

/**
 * Сверка пароля. Если хеша нет (нет пользователя или пароля), всё равно считаем bcrypt
 * по фиктивному хешу — время ответа не выдаёт, существует ли email.
 */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_COST);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
