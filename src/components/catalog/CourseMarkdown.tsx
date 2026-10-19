import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './catalog.css';

/**
 * Заголовки описания сдвинуты на уровень вниз: h2 страницы — «О курсе», внутри него h3 и ниже.
 * Сырой HTML не разбирается (rehype-raw не подключён), картинки не выводим, ссылки — только
 * безопасные схемы (urlTransform по умолчанию отбрасывает javascript:).
 */
const components: Components = {
  h1: ({ children }) => <h3 className="h3 cat-prose__h">{children}</h3>,
  h2: ({ children }) => <h3 className="h3 cat-prose__h">{children}</h3>,
  h3: ({ children }) => <h4 className="cat-prose__h4">{children}</h4>,
  h4: ({ children }) => <h4 className="cat-prose__h4">{children}</h4>,
  img: () => null,
  a: ({ href, children }) => {
    const external = typeof href === 'string' && /^https?:/i.test(href);
    return (
      <a href={href} className="text-link" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
};

export function CourseMarkdown({ source }: { source: string }) {
  return (
    <div className="cat-prose">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
