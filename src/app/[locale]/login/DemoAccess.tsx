import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { demoLoginAction } from '@/lib/auth/actions';
import { DEMO_ACCOUNTS } from '@/lib/auth/demo';
import { Eyebrow } from '@/components/ui';

/** Демо-доступ: вход в один клик под каждой ролью (только в демо-режиме). */
export async function DemoAccess({ locale, next }: { locale: string; next?: string }) {
  const t = await getTranslations('auth.demo');
  return (
    <section className="demo-access" aria-labelledby="demo-access-title">
      <div className="demo-access__head">
        <Eyebrow as="h3" id="demo-access-title">
          {t('eyebrow')}
        </Eyebrow>
        <p className="demo-access__lead">{t('lead')}</p>
      </div>
      <ul className="demo-access__grid">
        {DEMO_ACCOUNTS.map((acc) => (
          <li key={acc.email}>
            <form action={demoLoginAction}>
              <input type="hidden" name="email" value={acc.email} />
              <input type="hidden" name="locale" value={locale} />
              {next && <input type="hidden" name="next" value={next} />}
              <button
                type="submit"
                className="demo-tile"
                data-testid={`demo-login-${acc.role}`}
                aria-label={`${t('as')} ${t(`${acc.role}.title`)}: ${t(`${acc.role}.desc`)}`}
              >
                <span className="demo-tile__title">{t(`${acc.role}.title`)}</span>
                <span className="demo-tile__desc">{t(`${acc.role}.desc`)}</span>
                <ArrowRight aria-hidden="true" />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
