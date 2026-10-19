import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui';
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
          <section className="oops oops--full" aria-labelledby="oops-title">
            <div className="container">
              <div className="oops__copy">
                {/* eslint-disable-next-line @next/next/no-img-element -- векторный логотип из /public/brand */}
                <img className="oops__logo" src="/brand/crp-logo.svg" alt={common.brand.logoAlt} />
                <h1 id="oops-title" className="display oops__title">
                  {t.title}
                </h1>
                <p className="lead">{t.description}</p>
                <div className="oops__actions">
                  <Link href="/ru/courses" className={buttonClass({ variant: 'primary', size: 'lg' })}>
                    {t.courses}
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
