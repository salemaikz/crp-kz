import { Search } from 'lucide-react';
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
        <Field label={t('label')} hint={t('hint')}>
          <Input
            name="number"
            placeholder={t('placeholder')}
            defaultValue={defaultValue}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            required
          />
        </Field>
        <Button type="submit" size="lg">
          <Search aria-hidden="true" />
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
