import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

// Условие совпадает с scripts/prebuild.mjs и isDemo() (D-016, D-019)
const demoBuild =
  process.env.DEMO_MODE?.trim() === '1' || (process.env.VERCEL === '1' && !process.env.DATABASE_URL?.trim());

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next 16 по умолчанию дописывает правила в AGENTS.md при dev — у нас свои правила
  agentRules: false,
  // PGlite (встроенный Postgres для демо) — wasm и data-файлы, не бандлим
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingIncludes: {
    '/**': [
      './migrations/**/*.sql',
      ...(demoBuild ? ['./.demo/**'] : []),
      './node_modules/@electric-sql/pglite/dist/**/*',
      // тексты юридических документов, шрифты и логотип для PDF сертификата — читаются с диска на сервере
      './content/legal/**',
      './assets/fonts/pdf/**',
      './docs/brand/logo/crp-logo.png',
    ],
  },
};

export default withNextIntl(nextConfig);
