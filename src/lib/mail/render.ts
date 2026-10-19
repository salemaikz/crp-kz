// Сборка письма из строки очереди: тема, текстовая и HTML-версии. Текст собирается при показе
// и отправке, в базе хранятся только шаблон и параметры.
import { htmlLang } from '../content/l10n';
import { mailTranslator } from './i18n';
import { escapeHtml, oneLine, renderLayout } from './layout';
import type { MailRow } from './outbox';
import { buildContent } from './templates';
import type { RenderedMail } from './types';

export { escapeHtml, oneLine };

/**
 * Собрать письмо. hideSecretLink — для админки: ссылка с токеном не попадает ни в тему,
 * ни в текст, ни в HTML (в тексте остаётся только подпись кнопки).
 */
export function renderMail(row: MailRow, opts: { hideSecretLink?: boolean } = {}): RenderedMail {
  const t = mailTranslator(row.locale);
  const c = buildContent(row, t, opts);
  const name = typeof row.params.name === 'string' ? oneLine(row.params.name) : '';
  const greeting = t('common.greeting', { name });
  const signature = t('common.signature');
  const auto = t('common.auto');
  const subject = oneLine(c.subject);

  const blocks: string[] = [greeting, ...c.paragraphs];
  for (const l of c.lists) {
    blocks.push([l.title, ...l.items.map((i) => `- ${i}`), ...(l.note ? [l.note] : [])].join('\n'));
  }
  if (c.action) blocks.push(c.action.href ? `${c.action.label}: ${c.action.href}` : c.action.label);
  blocks.push(...c.after, `${signature}\n${auto}`);
  const text = blocks.join('\n\n');

  const html = renderLayout({
    lang: htmlLang(row.locale),
    title: subject,
    greeting,
    paragraphs: c.paragraphs,
    lists: c.lists,
    action: c.action,
    linkHint: t('common.linkHint'),
    after: c.after,
    signature,
    auto,
  });
  return { subject, text, html };
}
