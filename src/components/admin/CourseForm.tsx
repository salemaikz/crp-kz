'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, Checkbox, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui';
import { slugify } from '@/lib/admin/slug';
import type { ActionResult } from '@/lib/admin/result';
import { Link } from '@/lib/i18n/navigation';
import { ErrorAlert } from './ErrorAlert';
import { useActionForm } from './useActionForm';

/** Значения формы курса (строки — как в полях ввода). */
export type CourseFormValues = {
  titleRu: string;
  titleKz: string;
  summaryRu: string;
  summaryKz: string;
  descriptionRu: string;
  descriptionKz: string;
  slug: string;
  level: string;
  durationMin: string;
  visibility: 'public' | 'internal' | 'private';
  ownerOrgId: string;
  sequential: boolean;
  status: 'draft' | 'published';
  priceKzt: string;
  accessDays: string;
};

export const EMPTY_COURSE: CourseFormValues = {
  titleRu: '',
  titleKz: '',
  summaryRu: '',
  summaryKz: '',
  descriptionRu: '',
  descriptionKz: '',
  slug: '',
  level: '',
  durationMin: '',
  visibility: 'public',
  ownerOrgId: '',
  sequential: false,
  status: 'draft',
  priceKzt: '',
  accessDays: '',
};

type Props = {
  mode: 'create' | 'edit';
  action: (formData: FormData) => Promise<ActionResult<object>>;
  defaults: CourseFormValues;
  organizations: Array<{ id: string; name: string }>;
  /** Минут в сумме по урокам курса — подсказка к длительности. */
  lessonsMinutes?: number;
  cancelHref: string;
};

/** Форма курса: создание и правка. Ошибки валидации приходят с сервера и показываются у полей. */
export function CourseForm({ mode, action, defaults, organizations, lessonsMinutes, cancelHref }: Props) {
  const t = useTranslations('admin.courseForm');
  const tf = useTranslations('admin.errors.field');
  const tEnum = useTranslations('admin.enums');
  const form = useActionForm(action);
  const [title, setTitle] = useState(defaults.titleRu);
  const [slugInput, setSlugInput] = useState(defaults.slug);
  const [visibility, setVisibility] = useState(defaults.visibility);
  const [price, setPrice] = useState(defaults.priceKzt);

  const err = (name: string) => {
    const code = form.fieldError(name);
    return code ? (tf.has(code) ? tf(code) : tf('invalid')) : undefined;
  };
  const paid = Number(price.replace(/\s/g, '')) > 0;
  const editing = mode === 'edit';
  // адрес в подсказке: введённый, иначе прежний (правка) или построенный из названия (создание)
  const slugPreview = slugInput.trim() || (editing ? defaults.slug : slugify(title) || 'kurs');

  return (
    <form onSubmit={form.onSubmit} onChange={form.ok ? form.reset : undefined} noValidate className="adm-form">
      <Card as="section" padding="lg" aria-labelledby="cf-main">
        <header className="adm-card__head">
          <h2 id="cf-main" className="h3">
            {t('main.title')}
          </h2>
          <p className="muted">{t('main.lead')}</p>
        </header>
        <div className="adm-grid-2">
          <Field label={t('fields.titleRu')} required error={err('titleRu')}>
            <Input name="titleRu" defaultValue={defaults.titleRu} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('fields.titleKz')} error={err('titleKz')}>
            <Input name="titleKz" defaultValue={defaults.titleKz} maxLength={200} lang="kk" />
          </Field>
          <Field label={t('fields.summaryRu')} hint={t('hints.summary')} error={err('summaryRu')}>
            <Textarea name="summaryRu" defaultValue={defaults.summaryRu} rows={3} maxLength={600} />
          </Field>
          <Field label={t('fields.summaryKz')} error={err('summaryKz')}>
            <Textarea name="summaryKz" defaultValue={defaults.summaryKz} rows={3} maxLength={600} lang="kk" />
          </Field>
          <Field label={t('fields.descriptionRu')} hint={t('hints.description')} error={err('descriptionRu')}>
            <Textarea name="descriptionRu" defaultValue={defaults.descriptionRu} rows={9} className="adm-mono" />
          </Field>
          <Field label={t('fields.descriptionKz')} error={err('descriptionKz')}>
            <Textarea name="descriptionKz" defaultValue={defaults.descriptionKz} rows={9} className="adm-mono" lang="kk" />
          </Field>
        </div>
        <Field
          label={t('fields.slug')}
          hint={t(editing ? 'hints.slugEdit' : 'hints.slugCreate', { slug: slugPreview })}
          error={err('slug')}
          className="adm-field--narrow"
        >
          <Input
            name="slug"
            defaultValue={defaults.slug}
            placeholder={slugPreview}
            maxLength={60}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setSlugInput(e.target.value)}
          />
        </Field>
      </Card>

      <Card as="section" padding="lg" aria-labelledby="cf-params">
        <header className="adm-card__head">
          <h2 id="cf-params" className="h3">
            {t('params.title')}
          </h2>
        </header>
        <div className="adm-grid-2">
          <Field label={t('fields.level')} error={err('level')}>
            <Select name="level" defaultValue={defaults.level}>
              <option value="">{tEnum('level.none')}</option>
              <option value="start">{tEnum('level.start')}</option>
              <option value="base">{tEnum('level.base')}</option>
              <option value="pro">{tEnum('level.pro')}</option>
            </Select>
          </Field>
          <Field
            label={t('fields.durationMin')}
            hint={lessonsMinutes ? t('hints.durationLessons', { minutes: lessonsMinutes }) : t('hints.duration')}
            error={err('durationMin')}
          >
            <Input name="durationMin" defaultValue={defaults.durationMin} inputMode="numeric" placeholder="0" />
          </Field>
        </div>
        <Checkbox
          name="sequential"
          defaultChecked={defaults.sequential}
          label={
            <>
              <strong>{t('fields.sequential')}</strong>
              <span className="adm-check-hint">{t('hints.sequential')}</span>
            </>
          }
        />
      </Card>

      <Card as="section" padding="lg" aria-labelledby="cf-access">
        <header className="adm-card__head">
          <h2 id="cf-access" className="h3">
            {t('access.title')}
          </h2>
          <p className="muted">{t('access.lead')}</p>
        </header>
        <div className="adm-grid-2">
          <Field label={t('fields.visibility')} hint={t(`hints.visibility.${visibility}`)} error={err('visibility')}>
            <Select
              name="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as CourseFormValues['visibility'])}
            >
              <option value="public">{tEnum('visibility.public')}</option>
              <option value="internal">{tEnum('visibility.internal')}</option>
              <option value="private">{tEnum('visibility.private')}</option>
            </Select>
          </Field>
          {visibility !== 'public' && (
            <Field
              label={t('fields.ownerOrgId')}
              required={visibility === 'internal'}
              optionalLabel={visibility === 'private' ? t('optional') : undefined}
              hint={t(visibility === 'internal' ? 'hints.ownerInternal' : 'hints.ownerPrivate')}
              error={err('ownerOrgId')}
            >
              <Select name="ownerOrgId" defaultValue={defaults.ownerOrgId}>
                <option value="">{t('ownerChoose')}</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('fields.priceKzt')} hint={t('hints.price')} error={err('priceKzt')}>
            <Input
              name="priceKzt"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              placeholder={t('pricePlaceholder')}
            />
          </Field>
          {paid && (
            <Field label={t('fields.accessDays')} hint={t('hints.accessDays')} error={err('accessDays')}>
              <Input name="accessDays" defaultValue={defaults.accessDays} inputMode="numeric" placeholder="365" />
            </Field>
          )}
        </div>
      </Card>

      {editing && (
        <Card as="section" padding="lg" aria-labelledby="cf-publish">
          <header className="adm-card__head">
            <h2 id="cf-publish" className="h3">
              {t('publish.title')}
            </h2>
          </header>
          <Field label={t('fields.status')} hint={t('hints.status')} error={err('status')} className="adm-field--narrow">
            <Select name="status" defaultValue={defaults.status}>
              <option value="draft">{tEnum('status.draft')}</option>
              <option value="published">{tEnum('status.published')}</option>
            </Select>
          </Field>
        </Card>
      )}

      <div className="adm-savebar">
        <div className="adm-savebar__status" aria-live="polite">
          {form.ok && (
            <span className="adm-savebar__ok">
              <Check aria-hidden="true" /> {t('saved')}
            </span>
          )}
          {form.error && <ErrorAlert code={form.error} />}
        </div>
        <div className="adm-savebar__actions">
          <Link href={cancelHref} className="btn btn--ghost">
            {t('cancel')}
          </Link>
          <SubmitButton pending={form.pending} pendingText={t('saving')} data-testid="course-submit">
            {editing ? t('submitSave') : t('submitCreate')}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
