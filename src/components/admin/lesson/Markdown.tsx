'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown для предпросмотра в редакторе. Сырой HTML в react-markdown выключен по умолчанию,
 * ссылки открываются в новой вкладке без передачи opener.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="adm-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
