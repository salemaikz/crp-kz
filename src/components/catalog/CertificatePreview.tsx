import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import './catalog.css';

const GRID = 15;

/** Декоративный «QR»: три угловых метки и детерминированная россыпь модулей (не настоящий код). */
function pseudoQrPath(): string {
  const cells: string[] = [];
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const edge = x === 0 || y === 0 || x === 4 || y === 4;
        const core = x === 2 && y === 2;
        if (edge || core) cells.push(`M${ox + x} ${oy + y}h1v1h-1z`);
      }
    }
  };
  finder(0, 0);
  finder(GRID - 5, 0);
  finder(0, GRID - 5);
  let seed = 20261019;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const inFinder = (x < 6 && y < 6) || (x >= GRID - 6 && y < 6) || (x < 6 && y >= GRID - 6);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (!inFinder && seed % 5 < 2) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return cells.join('');
}

const QR_PATH = pseudoQrPath();

/** Превью сертификата: логотип, «Ваше имя», курс, номер и QR — как будет выглядеть результат. */
export function CertificatePreview({ courseTitle }: { courseTitle: string }) {
  const t = useTranslations('catalog.course.cert');
  const year = new Date().getFullYear();
  return (
    <Card padding="none" large className="cat-cert">
      <figure className="cat-cert__sheet" aria-label={t('alt')}>
        <Image src="/brand/crp-logo.svg" alt="" width={235} height={49} className="cat-cert__logo" unoptimized />
        <p className="cat-cert__kicker">{t('heading')}</p>
        <p className="cat-cert__holder display">{t('holder')}</p>
        <p className="cat-cert__text">{t('text')}</p>
        <p className="cat-cert__course">«{courseTitle}»</p>
        <div className="cat-cert__foot">
          <div>
            <span className="cat-cert__small">{t('number')}</span>
            <span className="cat-cert__num">CRP-{year}-XXXXXX</span>
          </div>
          <div className="cat-cert__qr">
            <svg viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
              <path d={QR_PATH} />
            </svg>
            <span className="cat-cert__small">{t('verify')}</span>
          </div>
        </div>
      </figure>
      <p className="cat-cert__caption">{t('caption')}</p>
    </Card>
  );
}
