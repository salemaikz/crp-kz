import Image from 'next/image';
import { unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { CRP_CONTACTS } from '@/lib/brand';
import { Link } from '@/lib/i18n/navigation';
import { isLegalEnabled } from '@/lib/legal/consents';
import { LEGAL_DOC_SLUG, type LegalDocKind } from '@/lib/legal/types';
import '@/components/legal/legal.css';

/** Документы в подвале: согласие открывается из политики и из подписей галочек, отдельной ссылки нет. */
const FOOTER_DOCS: readonly LegalDocKind[] = ['offer', 'privacy', 'refund'];

/** Вошёл ли пользователь: ссылки «Войти» и «Регистрация» ему не нужны. Сбой сессии = гость. */
async function isSignedIn(): Promise<boolean> {
  try {
    return Boolean(await getCurrentUser());
  } catch (err) {
    // служебные исключения Next (динамический рендер, redirect) пробрасываем
    unstable_rethrow(err);
    console.error('[footer] не удалось получить пользователя', err);
    return false;
  }
}

/** Подвал «ночь»: логотип, о платформе, ссылки, контакты, «Разработано SalemAI». */
export async function Footer() {
  const [t, signedIn] = await Promise.all([getTranslations('common'), isSignedIn()]);
  const year = new Date().getFullYear();
  // колонка «Документы» только при активном LEGAL (флаг и готовность документов)
  const legal = isLegalEnabled();
  const tl = legal ? await getTranslations('legal') : null;
  const crpNav = (
    <nav aria-labelledby="footer-crp">
      <h2 id="footer-crp">{t('footer.crp')}</h2>
      <ul>
        <li>
          <a href={CRP_CONTACTS.site} target="_blank" rel="noopener">
            {t('footer.crpSite')}
            <span className="visually-hidden"> ({t('a11y.external')})</span>
          </a>
        </li>
        <li>
          <a href={CRP_CONTACTS.site} target="_blank" rel="noopener">
            {t('footer.freeReview')}
            <span className="visually-hidden"> ({t('a11y.external')})</span>
          </a>
        </li>
      </ul>
    </nav>
  );
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
              {!signedIn && (
                <>
                  <li>
                    <Link href="/login">{t('header.login')}</Link>
                  </li>
                  <li>
                    <Link href="/register">{t('header.register')}</Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
          {legal && tl ? (
            <div className="legal-footer-col">
              {crpNav}
              <nav aria-labelledby="footer-legal">
                <h2 id="footer-legal">{tl('footer.title')}</h2>
                <ul>
                  {FOOTER_DOCS.map((kind) => (
                    <li key={kind}>
                      <Link href={`/legal/${LEGAL_DOC_SLUG[kind]}`}>{tl(`docs.${kind}`)}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : (
            crpNav
          )}
          <div>
            <h2>{t('footer.contacts')}</h2>
            <ul>
              <li>
                <a href={CRP_CONTACTS.phoneHref} className="site-footer__phone">
                  {CRP_CONTACTS.phone}
                </a>
              </li>
              <li>
                <a href={CRP_CONTACTS.site} target="_blank" rel="noopener">
                  {CRP_CONTACTS.siteLabel}
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
