import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FILE_URL_RE } from '@/lib/files/url';
import './learn.css';

/** Только http(s) и относительные адреса: остальное (data:, javascript:) не показываем. */
function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(url) ? url : undefined;
}

/** id файла из адреса /api/files/<id> (в нижнем регистре) или null. FILE_URL_RE глобальное: берём matchAll. */
function fileIdOf(url: string | undefined): string | null {
  if (!url) return null;
  const m = [...url.matchAll(FILE_URL_RE)][0];
  return m ? (m[1] as string).toLowerCase() : null;
}

export type MarkdownFiles = {
  /** UPLOADS активен. При false картинки и ссылки на /api/files/ не выводятся: выдача вернула бы 404. */
  filesEnabled?: boolean;
  /** Документы урока, которые этому читателю не выдаются (демо, не админ — D-038): id в любом регистре. */
  hiddenFileIds?: readonly string[];
  /** Подпись вместо такой ссылки (files.block.demoHidden). */
  hiddenLabel?: string;
};

function buildComponents({ filesEnabled = true, hiddenFileIds = [], hiddenLabel = '' }: MarkdownFiles): Components {
  const hidden = new Set(hiddenFileIds.map((id) => id.toLowerCase()));
  return {
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
      const fileId = fileIdOf(url);
      if (fileId && !filesEnabled) return <span>{children}</span>;
      if (fileId && hidden.has(fileId)) {
        // документ не выдаётся: ссылки нет, вместо неё нейтральная подпись
        return (
          <span data-testid="file-link-hidden">
            {children} <span className="lrn-file-note">{hiddenLabel}</span>
          </span>
        );
      }
      const external = /^https?:\/\//i.test(url);
      return (
        <a href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      const url = typeof src === 'string' ? safeUrl(src) : undefined;
      if (url && !filesEnabled && fileIdOf(url)) return null;
      // eslint-disable-next-line @next/next/no-img-element -- картинки из текста урока, размеры заранее неизвестны
      return url ? <img src={url} alt={alt ?? ''} loading="lazy" /> : null;
    },
    table: ({ children }) => (
      <div className="lrn-table">
        <table>{children}</table>
      </div>
    ),
  };
}

/**
 * Текст урока: Markdown с GFM (таблицы, чек-листы — галочки только для чтения).
 * Сырой HTML не выполняется и не показывается (skipHtml), ссылки проходят через safeUrl.
 */
export function Markdown({ children, ...files }: { children: string } & MarkdownFiles) {
  return (
    <div className="lrn-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(files)} skipHtml urlTransform={(u) => safeUrl(u) ?? ''}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
