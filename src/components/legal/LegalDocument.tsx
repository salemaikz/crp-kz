import { getTranslations } from 'next-intl/server';
import { Alert, Breadcrumbs, Card, Container, PageHeader, Section } from '@/components/ui';
import type { Locale } from '@/lib/content/types';
import { formatDate } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { versionDateMs } from '@/lib/legal/dates';
import { LEGAL_DOC_SLUG, type LegalText } from '@/lib/legal/types';
import { LegalMarkdown } from './LegalMarkdown';
import './legal.css';

type Props = {
  text: LegalText;
  locale: Locale;
  /** Архивная редакция: до какой даты действовала (effectiveFrom следующей) и что открыть вместо неё. */
  archivedUntil?: string;
  /** Другие редакции этого документа, кроме показанной. */
  history: Array<{ version: string; effectiveFrom: string }>;
};

/** Страница документа: крошки, заголовок из файла, плашка черновика, текст, прежние редакции. */
export async function LegalDocument({ text, locale, archivedUntil, history }: Props) {
  const [t, tc] = await Promise.all([getTranslations('legal'), getTranslations('common')]);
  const slug = LEGAL_DOC_SLUG[text.kind];
  const date = (d: string) => formatDate(versionDateMs(d), locale);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            label={tc('a11y.breadcrumbs')}
            items={[{ label: t('meta.index'), href: '/legal' }, { label: t(`docs.${text.kind}`) }]}
          />
        }
        title={text.title}
        lead={t('doc.edition', { date: date(text.effectiveFrom) })}
      />
      <Section tone="board" spacing="tight">
        <Container>
          <div className="legal-doc">
            {text.draft && <Alert tone="warning">{t('doc.draft')}</Alert>}
            {text.fallback && <Alert tone="info">{t('doc.fallback')}</Alert>}
            {archivedUntil && (
              <Alert tone="info">
                {t('doc.archived', { date: date(archivedUntil) })}{' '}
                <Link href={`/legal/${slug}`}>{t('doc.toCurrent')}</Link>
              </Alert>
            )}
            <Card large className="legal-doc__paper">
              <LegalMarkdown source={text.body} />
            </Card>
            {history.length > 0 && (
              <section className="legal-history" aria-labelledby="legal-history">
                <h2 id="legal-history">{t('doc.history')}</h2>
                <ul>
                  {history.map((h) => (
                    <li key={h.version}>
                      <Link href={`/legal/${slug}/${h.version}`}>{t('doc.edition', { date: date(h.effectiveFrom) })}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </Container>
      </Section>
    </>
  );
}
