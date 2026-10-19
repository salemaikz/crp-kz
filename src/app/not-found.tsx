import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass, Circles } from '@/components/ui';
import common from '../../messages/ru/common.json';
import { fontVariables } from '@/styles/fonts';
import './globals.css';

// 404 вне локали (например, /ru/несуществующий-путь не дошёл до [locale]).
// Рендерится без [locale]/layout, поэтому свой <html>, шрифты и тексты ru.
const t = common.notFound;

export const metadata: Metadata = { title: `${t.title} — ${common.brand.name}` };

export default function RootNotFound() {
  return (
    <html lang="ru" className={fontVariables} data-scroll-behavior="smooth">
      <body>
        <main id="main">
          <section className="oops oops--full on-night" aria-labelledby="oops-title">
            <Circles className="oops__rings" />
            <div className="container">
              <div className="oops__copy">
                <p className="display oops__code" aria-hidden="true">
                  404
                </p>
                <p className="eyebrow eyebrow--dot">{t.eyebrow}</p>
                <h1 id="oops-title" className="display oops__title">
                  {t.title}
                </h1>
                <p className="lead oops__lead">{t.description}</p>
                <div className="oops__actions">
                  <Link href="/ru/courses" className={buttonClass({ variant: 'primary', size: 'lg' })}>
                    {t.courses}
                  </Link>
                  <Link href="/ru" className={buttonClass({ variant: 'ghost', size: 'lg' })}>
                    {t.home}
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
