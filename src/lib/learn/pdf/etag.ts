// ETag PDF сертификата: хэш данных и версии макета. PDF не хранится, поэтому ETag считается
// до рендера, а совпадение If-None-Match даёт 304 без генерации.
import { createHash } from 'node:crypto';
import { CERT_PDF_TEMPLATE_VERSION, type CertificatePdfInput } from './types';

export function certificatePdfEtag(input: CertificatePdfInput): string {
  const h = createHash('sha256');
  h.update(
    JSON.stringify([
      CERT_PDF_TEMPLATE_VERSION,
      input.number,
      input.holderName,
      input.courseTitle,
      input.issuedAt,
      input.locale,
      input.verifyUrl,
      input.issuedDate,
      input.labels,
    ]),
  );
  return `W/"${h.digest('hex').slice(0, 32)}"`;
}
