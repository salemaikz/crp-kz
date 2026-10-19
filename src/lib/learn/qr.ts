// QR-код сертификата: SVG строкой (пакет qrcode), на сервере. В страницу — как data-URI в <img>,
// без вставки сырого HTML.
import QRCode from 'qrcode';

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#14161b', light: '#ffffff' },
  });
}

export async function qrDataUri(text: string): Promise<string> {
  return `data:image/svg+xml;utf8,${encodeURIComponent(await qrSvg(text))}`;
}

/** Адрес публичной проверки сертификата: {site}/{locale}/cert/{number}. */
export function certificateVerifyUrl(site: string, locale: string, number: string): string {
  return `${site.replace(/\/+$/, '')}/${locale}/cert/${encodeURIComponent(number)}`;
}
