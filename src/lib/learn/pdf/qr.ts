// QR для PDF вектором: путь SVG из матрицы модулей (пакет qrcode), без растровой картинки.
import QRCode from 'qrcode';

/**
 * size — число модулей по стороне, d — один путь из прямоугольников: подряд идущие тёмные модули
 * строки склеены в один (`M x y h<n> v1 h-<n> z`). Поле вокруг (≥ 4 модулей) задаёт viewBox вызывающего.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!qr.modules.get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && qr.modules.get(y, x)) x++;
      const len = x - start;
      parts.push(`M${start} ${y}h${len}v1h-${len}z`);
    }
  }
  return { size, d: parts.join('') };
}
