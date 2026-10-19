// Почтовый слой (D-030): очередь, шаблоны, ссылки, страница «Письма».
export * from './types';
export * from './config';
export { enqueueMail, cancelSecrets, normalizeRecipient, type MailRow } from './outbox';
export { renderMail } from './render';
export { mailLink } from './links';
export { resolveTransport, type MailTransport } from './transport';
export { listMail, getMailView, mailPagesActive, visibleDemoLink, MAIL_PAGE_SIZE, MAIL_STATUSES, type MailListRow, type MailView } from './admin';
