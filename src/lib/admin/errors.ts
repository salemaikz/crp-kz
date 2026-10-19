// Ошибки админских операций: код + (необязательно) ошибки по полям формы.
// Коды — стабильные строки: интерфейс переводит их через messages/*/admin.json (errors.*).

export type AdminErrorCode =
  | 'FORBIDDEN' // не администратор
  | 'NOT_FOUND' // курс, модуль, урок или пользователь не найден
  | 'VALIDATION' // входные данные не прошли проверку (см. fields / issues)
  | 'SLUG_TAKEN' // адрес (slug) уже занят
  | 'NO_PUBLISHED_LESSONS' // нельзя опубликовать курс без опубликованных уроков
  | 'LESSON_EMPTY' // нельзя опубликовать урок без контента
  | 'KZ_QUIZ_MISMATCH' // в казахской версии урока не те тесты, что в русской
  | 'MODULE_NOT_EMPTY' // удалить можно только пустой модуль
  | 'LESSON_HAS_PROGRESS' // у урока есть прогресс слушателей — удаление запрещено
  | 'COURSE_HAS_DATA' // у курса есть заказы, зачисления или сертификаты
  | 'CANNOT_CHANGE_SELF'; // администратор не меняет собственную роль

/** Ошибки по полям: имя поля → код ошибки (errors.field.<код>). */
export type FieldErrors = Record<string, string>;

/** Проблема в контенте урока: путь внутри {ru, kz}, код zod, исходное сообщение и границы (если есть). */
export type ContentIssue = {
  path: Array<string | number>;
  code: string;
  message: string;
  /** Тип значения для too_small / too_big: string | array | number … */
  type?: string;
  minimum?: number;
  maximum?: number;
};

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly fields?: FieldErrors,
    readonly issues?: ContentIssue[],
  ) {
    super(code);
    this.name = 'AdminError';
  }
}

export function isAdminError(e: unknown): e is AdminError {
  return e instanceof AdminError;
}
