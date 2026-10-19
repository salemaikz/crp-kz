// HTML-обёртка письма в стиле ЦРП (BRAND, «Без ИИ-шума»): только инлайн-стили, без картинок
// и пикселей отслеживания. Все значения экранируются здесь, шаблоны передают сырой текст.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');

/** Одна строка: переводы строк и управляющие символы заменяются пробелом (тема, имена, заголовки). */
export function oneLine(s: string): string {
  return s.replace(CONTROL_RE, ' ').replace(/ {2,}/g, ' ').trim();
}

export type LayoutInput = {
  lang: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  lists: Array<{ title: string; items: string[]; note?: string }>;
  action: { label: string; href: string | null } | null;
  linkHint: string;
  after: string[];
  signature: string;
  auto: string;
};

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#14161B';
const MUTED = '#6B707A';
const LINE = '#DCDED8';

const p = (text: string, style = '') =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};${style}">${escapeHtml(text)}</p>`;

/** Письмо целиком: серый фон, белая карточка 600 px с рамкой, одна кнопка-«пилюля». */
export function renderLayout(i: LayoutInput): string {
  const lists = i.lists
    .map(
      (l) =>
        `<p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${INK};font-weight:600">${escapeHtml(l.title)}</p>` +
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.55;color:${INK}">` +
        l.items.map((it) => `<li style="margin:0 0 4px">${escapeHtml(it)}</li>`).join('') +
        '</ul>' +
        (l.note ? p(l.note, `color:${MUTED};font-size:14px;`) : ''),
    )
    .join('');
  const action = i.action?.href
    ? `<p style="margin:8px 0 20px"><a href="${escapeHtml(i.action.href)}" style="display:inline-block;background:#E31E24;color:#FFFFFF;` +
      `text-decoration:none;font-size:16px;font-weight:600;line-height:1;padding:14px 26px;border-radius:999px">${escapeHtml(i.action.label)}</a></p>` +
      p(i.linkHint, `color:${MUTED};font-size:14px;margin-bottom:4px;`) +
      `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;word-break:break-all"><a href="${escapeHtml(i.action.href)}" style="color:#C4161C">${escapeHtml(i.action.href)}</a></p>`
    : '';
  return (
    '<!DOCTYPE html>' +
    `<html lang="${escapeHtml(i.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(i.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F3F4F1;font-family:${FONT}">` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F1"><tr><td align="center" style="padding:24px 12px">' +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:20px">` +
    '<tr><td style="padding:32px">' +
    p(i.greeting) +
    i.paragraphs.map((x) => p(x)).join('') +
    lists +
    action +
    i.after.map((x) => p(x, `color:${MUTED};font-size:14px;`)).join('') +
    `<p style="margin:24px 0 4px;font-size:15px;line-height:1.5;color:${INK};font-weight:600">${escapeHtml(i.signature)}</p>` +
    p(i.auto, `color:${MUTED};font-size:13px;margin:0;`) +
    '</td></tr></table></td></tr></table></body></html>'
  );
}
