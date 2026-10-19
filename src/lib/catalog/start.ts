// «Начать бесплатно»: самозачисление на бесплатный public или internal своей организации.
// Логика отдельно от server action — вызывается и из тестов без контекста запроса.
import { canAccessCourse, canSelfEnroll, enroll } from '../access';
import { getCourseDetail, getMemberOrgIds } from './queries';

export type StartResult = { ok: true; slug: string } | { ok: false; error: 'not_found' | 'forbidden' };

export async function startCourse(userId: string, slug: string): Promise<StartResult> {
  const memberOrgIds = await getMemberOrgIds(userId);
  // видимость: черновик, private и чужой internal для пользователя «не существуют»
  const course = await getCourseDetail(slug, memberOrgIds);
  if (!course) return { ok: false, error: 'not_found' };

  // Доступ уже есть (покупка, назначение со сроком…): не трогаем зачисление. enroll заменил бы
  // источник на 'self' и стёр срок сдачи, назначенный руководителем.
  if ((await canAccessCourse(userId, course.id)).ok) return { ok: true, slug: course.slug };

  // Единственный источник правды для self — canSelfEnroll; платный курс не откроется никогда.
  if (!(await canSelfEnroll(userId, { id: course.id }))) return { ok: false, error: 'forbidden' };

  try {
    await enroll({
      userId,
      courseId: course.id,
      source: 'self',
      // для internal привязываем к организации: при выходе из неё доступ отзовётся (SPEC §2)
      orgId: course.visibility === 'internal' ? course.ownerOrgId : null,
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'SELF_ENROLL_FORBIDDEN') return { ok: false, error: 'forbidden' };
    throw e;
  }
  return { ok: true, slug: course.slug };
}
