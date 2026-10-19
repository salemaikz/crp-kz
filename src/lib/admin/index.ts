// Серверная логика админки: курсы, программа, уроки, пользователи, сводка.
// Все функции принимают актора первым аргументом и бросают AdminError('FORBIDDEN') для не-администратора.
export { AdminError, isAdminError } from './errors';
export type { AdminErrorCode, ContentIssue, FieldErrors } from './errors';
export { assertAdmin } from './guard';
export type { Actor } from './guard';
export * from './courses';
export * from './structure';
export * from './lessons';
export * from './users';
export * from './stats';
export { slugify, SLUG_RE } from './slug';
