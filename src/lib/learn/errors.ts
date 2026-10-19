// Ожидаемые отказы логики обучения: страницы и server actions превращают их в понятные сообщения.

export type LearnErrorCode =
  | 'not_found' // курса/урока нет или он не опубликован
  | 'forbidden' // нет действующего зачисления
  | 'locked' // последовательный курс: предыдущий урок не пройден
  | 'invalid' // кривой ввод (формат ответов)
  | 'quiz_required' // урок нельзя завершить без сданных тестов
  | 'not_complete' // сертификат только после прохождения всех уроков
  | 'bad_content' // контент урока не проходит схему
  | 'rate_limited'; // слишком много попыток подряд

export class LearnError extends Error {
  constructor(
    readonly code: LearnErrorCode,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'LearnError';
  }
}
