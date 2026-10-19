// Загрузчик для тестов страниц: файлы .css импортируются как пустой модуль (в Node они не нужны).
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return next(url, context);
}`),
);
