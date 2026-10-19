import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';

const PHONE = '+7 701 100 09 29';
const PHONE_HREF = 'tel:+77011000929';
const SITE = 'https://crp.kz';

/** Подвал «ночь»: логотип, о платформе, ссылки, контакты, «Разработано SalemAI». */
export async function Footer() {
  const t = await getTranslations('common');
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Image src="/brand/crp-logo-white.svg" alt={t('brand.logoAlt')} width={235} height={49} unoptimized />
            <p className="site-footer__about">{t('footer.about')}</p>
          </div>
          <nav aria-labelledby="footer-learning">
            <h2 id="footer-learning">{t('footer.learning')}</h2>
            <ul>
              <li>
                <Link href="/courses">{t('nav.courses')}</Link>
              </li>
              <li>
                <Link href="/learn">{t('nav.learn')}</Link>
              </li>
              <li>
                <Link href="/login">{t('header.login')}</Link>
              </li>
              <li>
                <Link href="/register">{t('header.register')}</Link>
              </li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-crp">
            <h2 id="footer-crp">{t('footer.crp')}</h2>
            <ul>
              <li>
                <a href={SITE} target="_blank" rel="noopener">
                  {t('footer.crpSite')}
                  <span className="visually-hidden"> ({t('a11y.external')})</span>
                </a>
              </li>
              <li>
                <a href={SITE} target="_blank" rel="noopener">
                  {t('footer.freeReview')}
                  <span className="visually-hidden"> ({t('a11y.external')})</span>
                </a>
              </li>
            </ul>
          </nav>
          <div>
            <h2>{t('footer.contacts')}</h2>
            <ul>
              <li>
                <a href={PHONE_HREF} className="site-footer__phone">
                  {PHONE}
                </a>
              </li>
              <li>
                <a href={SITE} target="_blank" rel="noopener">
                  crp.kz
                </a>
              </li>
              <li>{t('footer.city')}</li>
            </ul>
          </div>
        </div>
        <div className="site-footer__bottom">
          <span>{t('footer.rights', { year })}</span>
          <span className="site-footer__made">{t('footer.madeBy')}</span>
        </div>
      </div>
    </footer>
  );
}
