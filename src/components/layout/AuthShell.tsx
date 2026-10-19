import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Circles, Container, Eyebrow } from '@/components/ui';
import { CRP_CONTACTS } from '@/lib/brand';

type Props = {
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  cardTitle: ReactNode;
  cardLead?: ReactNode;
  children: ReactNode;
};

/**
 * Каркас входа/регистрации: тёмная секция с красным свечением и кольцами,
 * слева текст и преимущества, справа белая карточка формы (как lead-form на сайте).
 */
export async function AuthShell({ eyebrow, title, lead, cardTitle, cardLead, children }: Props) {
  const t = await getTranslations('auth');
  return (
    <section className="auth on-night" aria-labelledby="auth-title">
      <Circles className="auth__rings" />
      <Container className="auth__grid">
        <div className="auth__copy">
          <Eyebrow variant="dot">{eyebrow}</Eyebrow>
          <h1 id="auth-title" className="display auth__title">
            {title}
          </h1>
          <p className="auth__lead">{lead}</p>
        </div>

        <div className="auth__card on-paper">
          <div className="auth__card-head">
            <h2 className="auth__card-title">{cardTitle}</h2>
            {cardLead && <p className="auth__card-lead">{cardLead}</p>}
          </div>
          {children}
        </div>

        <div className="auth__aside">
          <ul className="auth__points">
            <li>{t('points.experts')}</li>
            <li>{t('points.tests')}</li>
            <li>{t('points.mobile')}</li>
          </ul>
          <p className="auth__help">
            <span>{t('help.title')}</span>
            <span>
              {t.rich('help.text', {
                number: CRP_CONTACTS.phone,
                phone: (chunks) => <a href={CRP_CONTACTS.phoneHref}>{chunks}</a>,
              })}
            </span>
          </p>
        </div>
      </Container>
    </section>
  );
}
