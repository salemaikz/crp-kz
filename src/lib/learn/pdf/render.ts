// Рендер PDF сертификата. Тяжёлый модуль (react-pdf, шрифты): маршрут подключает его лениво.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { CertificateDocument } from './CertificateDocument';
import { registerPdfFonts } from './fonts';
import type { CertificatePdfInput } from './types';

let logoCache: Buffer | null = null;

/** Логотип берётся только из docs/brand/logo, не перерисовывается. */
async function loadLogo(): Promise<Buffer> {
  logoCache ??= await readFile(path.join(process.cwd(), 'docs/brand/logo/crp-logo.png'));
  return logoCache;
}

/**
 * Очередь рендеров: шрифты react-pdf — глобальное состояние процесса (см. registerPdfFonts),
 * поэтому документы собираются по одному. Рендер — десятки миллисекунд, лимит маршрута —
 * 10 в минуту на пользователя, так что очередь не узкое место.
 */
let queue: Promise<unknown> = Promise.resolve();

export function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const job = queue.then(async () => {
    registerPdfFonts();
    const logo = await loadLogo();
    const buf = await renderToBuffer(CertificateDocument({ ...input, logo }));
    return new Uint8Array(buf);
  });
  queue = job.catch(() => undefined); // ошибка одного рендера не останавливает очередь
  return job;
}
