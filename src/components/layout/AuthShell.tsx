import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Card, Container } from '@/components/ui';
import { CRP_CONTACTS } from '@/lib/brand';

type Props = {
  title: ReactNode;
  /** Одна строка под заголовком: что нужно ввести. */
  lead?: ReactNode;
  children: ReactNode;
};

/**
 * Каркас входа и регистрации: простая страница на «доске». Заголовок, одна строка
 * пояснения, карточка с формой и телефон помощи. Без колец, маркера и лозунгов.
 */
export async function AuthShell({ title, lead, children }: Props) {
  const t = await getTranslations('auth');
  return (
    <section className="auth" aria-labelledby="auth-title">
      <Container>
        <div className="auth__col">
          <header className="auth__head">
            <h1 id="auth-title" className="display auth__title">
              {title}
            </h1>
            {lead && <p className="lead auth__lead">{lead}</p>}
          </header>

          <Card large padding="lg" className="auth__card">
            {children}
          </Card>

          <p className="auth__help">
            {t('help.title')}{' '}
            {t.rich('help.text', {
              number: CRP_CONTACTS.phone,
              phone: (chunks) => <a href={CRP_CONTACTS.phoneHref}>{chunks}</a>,
            })}
          </p>
        </div>
      </Container>
    </section>
  );
}
