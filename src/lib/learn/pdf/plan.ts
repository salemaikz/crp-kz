// План текстов PDF сертификата: очистка, кегль и разбивка по строкам. Единое правило
// «PDF недоступен» для маршрута, страницы и документа.
import { cleanCertificateTexts } from './glyphs';
import { COURSE_MIN_SIZE, NAME_MIN_SIZE, courseFontSize, fitBlock, nameFontSize } from './layout';
import { geologicaMeasure } from './measure';

/** Ширина строки ФИО и блока названия курса, pt. Задаётся и стилем текста, и fitText: резка слов совпадает. */
export const NAME_MAX_WIDTH = 700;
export const COURSE_MAX_WIDTH = 522;
/** Трекинг ФИО, в долях кегля. */
export const NAME_TRACKING = -0.03;
/** Предел по высоте: больше строк на листе не помещается между заголовком и подвалом. */
export const NAME_MAX_LINES = 3;
export const COURSE_MAX_LINES = 5;
/** Жёсткие пределы кегля, до которых можно опускаться ниже минимума ради высоты, pt. */
export const NAME_HARD_MIN_SIZE = 14;
export const COURSE_HARD_MIN_SIZE = 12;

export type TextFit = { text: string; size: number };

/** ok=false: PDF выдавать нельзя; name и course всё равно посчитаны (рендер напрямую, тесты). */
export type CertificatePdfPlan = { ok: boolean; name: TextFit; course: TextFit };

/**
 * PDF недоступен, если имя или курс пусты после очистки, при очистке выброшены буквы (имя
 * напечаталось бы обрезанным) или текст не укладывается по высоте даже на жёстком пределе кегля.
 * Тогда страница предлагает печать браузером, а маршрут отвечает 303 на страницу.
 */
export function planCertificatePdf(c: { holderName: string; courseTitle: string }): CertificatePdfPlan {
  const { holder, course, droppedLetters } = cleanCertificateTexts(c);
  // слово без пробелов не переносится, поэтому кегль подгоняется под ширину по замеру самого шрифта
  const name = fitBlock(holder, nameFontSize(holder), NAME_MIN_SIZE, NAME_HARD_MIN_SIZE, NAME_MAX_WIDTH, NAME_MAX_LINES, geologicaMeasure(NAME_TRACKING));
  const courseFit = fitBlock(course, courseFontSize(course), COURSE_MIN_SIZE, COURSE_HARD_MIN_SIZE, COURSE_MAX_WIDTH, COURSE_MAX_LINES, geologicaMeasure());
  const ok = !!holder && !!course && !droppedLetters && name.fits && courseFit.fits;
  return { ok, name: { text: name.text, size: name.size }, course: { text: courseFit.text, size: courseFit.size } };
}
