import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Только http(s), mailto, tel, якоря и относительные адреса; остальное (javascript:, data:) отбрасывается. */
export function legalUrl(url: string): string {
  // браузер трактует обратную косую как '/' и отбрасывает управляющие символы и пробелы: такие адреса не пропускаем
  for (const ch of url) {
    const c = ch.charCodeAt(0);
    if (ch === '\\' || c <= 0x20 || c === 0x7f) return '';
  }
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(url)) return url;
  return /^\/(?!\/)/.test(url) ? url : '';
}

const components: Components = {
  a: ({ href, children }) => {
    const url = href ? legalUrl(href) : '';
    if (!url) return <span>{children}</span>;
    const external = /^https?:\/\//i.test(url);
    return (
      <a href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
  // картинок в документах нет
  img: () => null,
};

/** Markdown документа без HTML (rehype-raw не подключён): текст приходит из репозитория через ревью. */
export function LegalMarkdown({ source }: { source: string }) {
  return (
    <div className="legal-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={legalUrl} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
