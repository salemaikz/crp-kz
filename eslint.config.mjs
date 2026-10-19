import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...next,
  ...nextTs,
  { ignores: ['.next/**', 'node_modules/**', 'docs/**', '.claude/**', 'playwright-report/**', 'test-results/**'] },
];

export default config;
