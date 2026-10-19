import { getTranslations } from 'next-intl/server';
import { demoLoginAction } from '@/lib/auth/actions';
import { DEMO_ACCOUNTS } from '@/lib/auth/demo';

/** Демо-доступ: вход в один клик под каждой ролью (только в демо-режиме). */
export async function DemoAccess({ locale, next }: { locale: string; next?: string }) {
  const t = await getTranslations('auth.demo');
  return (
    <section className="demo-access" aria-labelledby="demo-access-title">
      <div className="demo-access__head">
        <h2 id="demo-access-title" className="demo-access__title">
          {t('title')}
        </h2>
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
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
