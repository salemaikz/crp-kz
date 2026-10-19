import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  ...next,
  ...nextTs,
  { ignores: ['.next/**', 'node_modules/**', 'docs/**', 'playwright-report/**', 'test-results/**'] },
];
