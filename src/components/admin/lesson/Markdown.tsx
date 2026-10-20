'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FILE_URL_RE } from '@/lib/files/url';

/** Адрес выдачи файлов: при выключенном UPLOADS он отвечает 404, поэтому в предпросмотре его не выводим. */
function isFileUrl(url: string | undefined): boolean {
  return !!url && [...url.matchAll(FILE_URL_RE)].length > 0;
}

/**
 * Markdown для предпросмотра в редакторе. Сырой HTML в react-markdown выключен по умолчанию,
 * ссылки открываются в новой вкладке без передачи opener.
 */
export function Markdown({ children, filesEnabled = true }: { children: string; filesEnabled?: boolean }) {
  return (
    <div className="adm-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: kids }) =>
            !filesEnabled && isFileUrl(href) ? (
              <span>{kids}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {kids}
              </a>
            ),
          img: ({ src, alt }) =>
            !filesEnabled && isFileUrl(typeof src === 'string' ? src : undefined) ? (
              <span>{alt}</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- предпросмотр произвольных картинок текста
              <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} />
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
