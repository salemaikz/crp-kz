// Какая кнопка на странице курса: «Продолжить» / «Начать» / «Купить» (чистая функция).
// Нормативно: docs/lms/BUILD.md §4, §6. Доступ даёт только зачисление; self — только бесплатные
// public или internal своей организации; платный курс self не даёт никогда.
import type { AccessResult } from '../access';
import type { CourseVisibility } from './types';

export type CourseCta =
  /** Есть действующее зачисление → /learn/[slug]. */
  | { kind: 'continue' }
  /** Бесплатный public или internal своей организации → server action startCourseAction. */
  | { kind: 'start'; audience: 'free' | 'staff'; needsLogin: boolean }
  /**
   * Платный → /courses/[slug]/buy. renew — доступ был, но закончился. needsLogin — гость:
   * покупка только после входа (D-020), ведём на вход с возвратом к покупке.
   */
  | { kind: 'buy'; renew: boolean; needsLogin: boolean }
  /** Платный, но продажи на паузе (offer.active = false). */
  | { kind: 'paused' }
  /** Курс не открывается этому зрителю (internal не для него, private). */
  | { kind: 'unavailable' };

export type CtaInput = {
  visibility: CourseVisibility;
  /** Цена из offer; null — предложения нет. */
  priceKzt: number | null;
  offerActive: boolean;
  /** Зритель состоит в организации-владельце курса. */
  isMember: boolean;
  loggedIn: boolean;
  /** Состояние зачисления зрителя; null — гость. */
  access: AccessResult | null;
};

export function resolveCourseCta(input: CtaInput): CourseCta {
  if (input.access?.ok) return { kind: 'continue' };
  const paid = (input.priceKzt ?? 0) > 0;
  const needsLogin = !input.loggedIn;

  if (input.visibility === 'internal') {
    // внутренний курс платным не бывает: цена > 0 запрещает self (canSelfEnroll)
    if (input.isMember && !paid) return { kind: 'start', audience: 'staff', needsLogin };
    return { kind: 'unavailable' };
  }
  if (input.visibility === 'public') {
    if (!paid) return { kind: 'start', audience: 'free', needsLogin };
    if (!input.offerActive) return { kind: 'paused' };
    return { kind: 'buy', renew: input.access?.reason === 'expired', needsLogin };
  }
  return { kind: 'unavailable' };
}
