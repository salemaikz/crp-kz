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

/** Межстрочные множители блоков в макете (CertificateDocument). */
export const NAME_LINE_HEIGHT = 1.05;
export const COURSE_LINE_HEIGHT = 1.15;
/**
 * Бюджет высоты строк ФИО и курса, pt. Тело листа между логотипом и подвалом ≈ 346,8 pt; заголовок,
 * две подписи и отступы занимают до ≈ 110 pt (замер по PDF), ещё 2 pt запаса.
 */
export const TEXT_HEIGHT_BUDGET = 232;

/** Высота строк ФИО и курса, pt. */
export function textHeight(nameLines: number, nameSize: number, courseLines: number, courseSize: number): number {
  return nameLines * nameSize * NAME_LINE_HEIGHT + courseLines * courseSize * COURSE_LINE_HEIGHT;
}

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
  const fitName = (size: number) =>
    fitBlock(holder, size, size < NAME_MIN_SIZE ? NAME_HARD_MIN_SIZE : NAME_MIN_SIZE, NAME_HARD_MIN_SIZE, NAME_MAX_WIDTH, NAME_MAX_LINES, geologicaMeasure(NAME_TRACKING));
  const fitCourse = (size: number) =>
    fitBlock(course, size, size < COURSE_MIN_SIZE ? COURSE_HARD_MIN_SIZE : COURSE_MIN_SIZE, COURSE_HARD_MIN_SIZE, COURSE_MAX_WIDTH, COURSE_MAX_LINES, geologicaMeasure());
  let name = fitName(nameFontSize(holder));
  let courseFit = fitCourse(courseFontSize(course));
  // предел по строкам не ограничивает высоту при крупном кегле: уменьшаем кегли, пока сумма высот
  // не уложится в бюджет; первым — тот блок, который выше, до жёстких пределов
  const height = () => textHeight(name.lines, name.size, courseFit.lines, courseFit.size);
  while (name.fits && courseFit.fits && height() > TEXT_HEIGHT_BUDGET) {
    const nameH = name.lines * name.size * NAME_LINE_HEIGHT;
    const courseH = courseFit.lines * courseFit.size * COURSE_LINE_HEIGHT;
    const canName = name.size > NAME_HARD_MIN_SIZE;
    const canCourse = courseFit.size > COURSE_HARD_MIN_SIZE;
    if (!canName && !canCourse) break;
    if (canName && (nameH >= courseH || !canCourse)) name = fitName(name.size - 0.5);
    else courseFit = fitCourse(courseFit.size - 0.5);
  }
  const ok =
    !!holder && !!course && !droppedLetters && name.fits && courseFit.fits && height() <= TEXT_HEIGHT_BUDGET;
  return { ok, name: { text: name.text, size: name.size }, course: { text: courseFit.text, size: courseFit.size } };
}
