import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './learn.css';

/** Только http(s) и относительные адреса: остальное (data:, javascript:) не показываем. */
function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(url) ? url : undefined;
}

const components: Components = {
  // в уроке один h1 (название урока), поэтому # и ## в тексте — второй уровень
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h4>{children}</h4>,
  h6: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => {
    const url = safeUrl(href);
    if (!url) return <span>{children}</span>;
    const external = /^https?:\/\//i.test(url);
    return (
      <a href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const url = typeof src === 'string' ? safeUrl(src) : undefined;
    // eslint-disable-next-line @next/next/no-img-element -- картинки из текста урока, размеры заранее неизвестны
    return url ? <img src={url} alt={alt ?? ''} loading="lazy" /> : null;
  },
  table: ({ children }) => (
    <div className="lrn-table">
      <table>{children}</table>
    </div>
  ),
};

/**
 * Текст урока: Markdown с GFM (таблицы, чек-листы — галочки только для чтения).
 * Сырой HTML не выполняется и не показывается (skipHtml), ссылки проходят через safeUrl.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="lrn-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml urlTransform={(u) => safeUrl(u) ?? ''}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
