import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite (встроенный Postgres для демо) — wasm и data-файлы, не бандлим
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingIncludes: {
    '/**': ['./migrations/**/*.sql', './node_modules/@electric-sql/pglite/dist/**/*'],
  },
};

export default withNextIntl(nextConfig);
