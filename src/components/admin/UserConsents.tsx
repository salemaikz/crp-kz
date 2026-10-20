// Блок «Согласия» в карточке пользователя (legal §3.3 «Админка»). Только для администратора:
// данные приходят из getUserConsents, который сам проверяет роль. Серверный компонент.
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui';
import type { Locale } from '@/lib/content/types';
import { formatDate } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { findVersion } from '@/lib/legal/registry';
import { CONSENT_DOC, LEGAL_DOC_SLUG, type ConsentKind } from '@/lib/legal/types';
import type { ConsentView } from '@/lib/legal/consents';

/** Ссылка на редакцию документа, если она есть в реестре; у легаси-строк и cross_border её нет. */
function versionHref(kind: ConsentKind, version: string, legacy: boolean): string | null {
  const doc = CONSENT_DOC[kind];
  if (legacy || !doc || !findVersion(doc, version)) return null;
  return `/legal/${LEGAL_DOC_SLUG[doc]}/${version}`;
}

export async function UserConsents({ consents, locale }: { consents: ConsentView[]; locale: Locale }) {
  const t = await getTranslations('legal.admin');
  return (
    <Card as="section" padding="lg" aria-labelledby="u-consents" data-testid="user-consents">
      <header className="adm-card__head">
        <h2 id="u-consents" className="h3">
          {t('title')}
        </h2>
      </header>
      {consents.length === 0 ? (
        <p className="muted">{t('empty')}</p>
      ) : (
        <ul className="adm-orglist">
          {consents.map((c, i) => {
            // легаси: согласие записано без текста документа (до публикации документов или при выключенном LEGAL)
            const legacy = c.textSha256 === null;
            const href = versionHref(c.kind, c.version, legacy);
            return (
              <li key={`${c.kind}-${c.createdAt}-${i}`} data-testid="consent-row" data-legacy={legacy ? '1' : undefined}>
                <strong>{t(`kind.${c.kind}`)}</strong>
                <span className="meta">
                  {legacy ? (
                    t('legacy')
                  ) : href ? (
                    <Link href={href}>{c.version}</Link>
                  ) : (
                    c.version
                  )}
                  {c.locale ? ` · ${c.locale.toUpperCase()}` : ''}
                  {c.context === 'register' || c.context === 'checkout'
                    ? ` · ${t(`context.${c.context}`, { number: c.orderNumber ?? '' })}`
                    : ''}
                  {` · ${formatDate(c.createdAt, locale, { short: true, withTime: true })}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
