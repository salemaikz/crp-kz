import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/lib/content/types';
import { formatDate } from '@/lib/format';
import './learn.css';

type Props = {
  holderName: string;
  courseTitle: string;
  issuedAt: number;
  number: string;
  /** Язык сертификата = язык, на котором проходили курс. */
  locale: Locale;
  /** QR как data-URI (SVG), собран на сервере. */
  qrSrc: string;
  /** Адрес страницы проверки без схемы — подпись под QR. */
  verifyHost: string;
};

/**
 * Лист сертификата: A4 альбомный, белый, красный логотип, красная линия по краю.
 * Все размеры в cqw — на экране лист масштабируется, в печати занимает ровно страницу.
 */
export async function CertificateSheet({ holderName, courseTitle, issuedAt, number, locale, qrSrc, verifyHost }: Props) {
  const t = await getTranslations({ locale, namespace: 'learn.certificate.sheet' });
  return (
    <div className="lrn-cert-wrap">
      <article className="lrn-cert" aria-label={t('aria', { name: holderName })} lang={locale === 'kz' ? 'kk' : 'ru'} data-testid="certificate">
        <div className="lrn-cert__frame">
          <header className="lrn-cert__head">
            {/* eslint-disable-next-line @next/next/no-img-element -- векторный логотип из /public/brand */}
            <img className="lrn-cert__logo" src="/brand/crp-logo.svg" alt={t('logoAlt')} />
            <span className="lrn-cert__kind">{t('kind')}</span>
          </header>

          <div className="lrn-cert__body">
            <p className="lrn-cert__title">{t('title')}</p>
            <p className="lrn-cert__small">{t('certifies')}</p>
            <p className="lrn-cert__name">{holderName}</p>
            <p className="lrn-cert__small">{t('completed')}</p>
            <p className="lrn-cert__course">{courseTitle}</p>
          </div>

          <footer className="lrn-cert__foot">
            <dl className="lrn-cert__facts">
              <div className="lrn-cert__fact">
                <dt>{t('issued')}</dt>
                <dd>{formatDate(issuedAt, locale)}</dd>
              </div>
              <div className="lrn-cert__fact">
                <dt>{t('number')}</dt>
                <dd>{number}</dd>
              </div>
            </dl>
            <div className="lrn-cert__sign">
              <strong>{t('org')}</strong>
              <span>{t('place')}</span>
            </div>
            <div className="lrn-cert__qr">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR как data-URI, собран на сервере */}
              <img src={qrSrc} alt={t('qrAlt', { number })} />
              <strong>{t('qrTitle')}</strong>
              <span>{verifyHost}</span>
            </div>
          </footer>
        </div>
      </article>
    </div>
  );
}
