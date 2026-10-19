import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { MailStatusBadge } from '@/components/admin/mail/MailStatusBadge';
import '@/components/admin/mail/mail.css';
import { Alert, Card } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { getMailView, mailPagesActive } from '@/lib/mail';
import { adminPage } from '../../_shared';

/** Путь, запрос и фрагмент без хоста. */
function relativeLink(link: string): string {
  const u = new URL(link);
  return `${u.pathname}${u.search}${u.hash}`;
}

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('mailLetter'), robots: { index: false, follow: false } };
}

/**
 * Письмо целиком: тема, получатель, статус и текст. Ссылка с токеном действует как пароль,
 * поэтому в тексте её нет, а отдельным блоком она показана только в демо.
 */
export default async function AdminMailLetterPage({ params }: Props) {
  if (!mailPagesActive()) notFound();
  const { id } = await params;
  const { locale, user } = await adminPage(params, `/admin/mail/${id}`);
  const mail = await getMailView(user, id);
  if (!mail) notFound();

  const [t, tn, tc] = await Promise.all([
    getTranslations('admin.mail'),
    getTranslations('admin.shell'),
    getTranslations('common.a11y'),
  ]);
  const when = (ms: number) => formatDate(ms, locale, { withTime: true });

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [{ label: tn('nav.mail'), href: '/admin/mail' }, { label: t(`template.${mail.template}`) }],
        }}
        title={mail.subject}
      />

      <Card as="section" padding="lg">
        <dl className="adm-mail-dl">
          <div>
            <dt>{t('detail.to')}</dt>
            <dd data-testid="mail-to">{mail.toEmail}</dd>
          </div>
          <div>
            <dt>{t('detail.template')}</dt>
            <dd>{t(`template.${mail.template}`)}</dd>
          </div>
          <div>
            <dt>{t('detail.status')}</dt>
            <dd data-testid="mail-status">
              <MailStatusBadge status={mail.status} />
            </dd>
          </div>
          <div>
            <dt>{t('detail.attempts')}</dt>
            <dd>{mail.attempts}</dd>
          </div>
          <div>
            <dt>{t('detail.created')}</dt>
            <dd>{when(mail.createdAt)}</dd>
          </div>
          {mail.sentAt !== null && (
            <div>
              <dt>{t('detail.sent')}</dt>
              <dd>{when(mail.sentAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {mail.lastError && (
        <Alert tone="error" title={t('lastError')}>
          {mail.lastError}
        </Alert>
      )}

      <Card as="section" padding="lg" aria-labelledby="mail-text">
        <header className="adm-card__head">
          <h2 id="mail-text" className="h3">
            {t('detail.text')}
          </h2>
        </header>
        <pre className="adm-mono adm-mail-text" data-testid="mail-text">
          {mail.text}
        </pre>
      </Card>

      {mail.demoLink ? (
        <Card as="section" padding="lg" aria-labelledby="mail-demo-link">
          <header className="adm-card__head">
            <h2 id="mail-demo-link" className="h3">
              {t('demoLink')}
            </h2>
          </header>
          {/* ссылка относительная: в превью и на других экземплярах демо открывается текущий хост, а не адрес сайта */}
          <a className="adm-mail-link" href={relativeLink(mail.demoLink)} data-testid="mail-demo-link">
            {mail.demoLink}
          </a>
        </Card>
      ) : (
        (mail.template === 'password_reset' || mail.template === 'email_verify') && (
          <p className="meta" data-testid="mail-link-hidden">
            {t('linkHidden')}
          </p>
        )
      )}
    </>
  );
}
