import { getTranslations } from 'next-intl/server';
import { Button, Field, Input } from '@/components/ui';
import { lookupCertificateAction } from '@/lib/learn/actions';
import './learn.css';

/** Форма «Проверить сертификат по номеру»: обычная форма на server action, работает без JS. */
export async function CertLookup({ locale, defaultValue }: { locale: string; defaultValue?: string }) {
  const t = await getTranslations('learn.verify.form');
  return (
    <form action={lookupCertificateAction} className="lrn-lookup">
      <input type="hidden" name="locale" value={locale} />
      <div className="lrn-lookup__row">
        <Field label={t('label')}>
          <Input
            name="number"
            placeholder={t('placeholder')}
            defaultValue={defaultValue}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            required
            aria-describedby="cert-lookup-hint"
          />
        </Field>
        <Button type="submit" size="lg">
          {t('submit')}
        </Button>
      </div>
      <p id="cert-lookup-hint" className="lrn-lookup__hint">
        {t('hint')}
      </p>
    </form>
  );
}
