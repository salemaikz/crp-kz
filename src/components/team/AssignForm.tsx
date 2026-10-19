'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Checkbox, Field, Input, Select, SubmitButton } from '@/components/ui';
import { assignCourseAction, type AssignState } from '@/lib/team/actions';
import './team.css';

export type AssignEmployee = { userId: string; name: string; position: string | null };
export type AssignCourseOption = { id: string; title: string; group: 'internal' | 'public' };

type Props = {
  orgId: string;
  employees: AssignEmployee[];
  courses: AssignCourseOption[];
  /** Сегодняшняя дата в Астане (YYYY-MM-DD): раньше срок выбрать нельзя. */
  minDate: string;
  maxAssign: number;
};

/** Форма «Назначить курс»: сотрудники (чекбоксы), курс, срок. Права и данные проверяет сервер. */
export function AssignForm({ orgId, employees, courses, minDate, maxAssign }: Props) {
  const t = useTranslations('team.assign');
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courseId, setCourseId] = useState('');
  const [due, setDue] = useState('');

  const [state, formAction, pending] = useActionState<AssignState, FormData>(async (prev, formData) => {
    const result = await assignCourseAction(prev, formData);
    // успех — очищаем выбор; ошибка — оставляем всё как есть, чтобы можно было поправить
    if (result?.status === 'success') {
      setSelected(new Set());
      setDue('');
    }
    return result;
  }, undefined);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const internal = courses.filter((c) => c.group === 'internal');
  const pub = courses.filter((c) => c.group === 'public');
  const canSubmit = selected.size > 0 && courseId !== '';

  return (
    <form action={formAction} className="team-assign">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />

      <fieldset className="team-assign__employees">
        <legend className="field__label">{t('employees')}</legend>
        {employees.length === 0 ? (
          <p className="muted">{t('noEmployees')}</p>
        ) : (
          <>
            <div className="team-assign__bar">
              <span className="team-assign__count" aria-live="polite">
                {t('selected', { count: selected.size })}
              </span>
              <button
                type="button"
                className="team-link-btn"
                onClick={() => setSelected(new Set(employees.map((e) => e.userId)))}
              >
                {t('selectAll')}
              </button>
              <button type="button" className="team-link-btn" onClick={() => setSelected(new Set())}>
                {t('clearAll')}
              </button>
            </div>
            <ul className="team-assign__list">
              {employees.map((e) => (
                <li key={e.userId}>
                  <Checkbox
                    id={`emp-${e.userId}`}
                    name="userIds"
                    value={e.userId}
                    checked={selected.has(e.userId)}
                    onChange={(ev) => toggle(e.userId, ev.target.checked)}
                    label={
                      <span className="team-emp">
                        <span className="team-emp__text">
                          <span className="team-emp__name">{e.name}</span>
                          <span className="team-emp__pos">{e.position ?? t('noPosition')}</span>
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <div className="team-assign__side">
        <Field label={t('course')} required>
          <Select name="courseId" value={courseId} onChange={(ev) => setCourseId(ev.target.value)}>
            <option value="">{t('coursePlaceholder')}</option>
            {internal.length > 0 && (
              <optgroup label={t('groupInternal')}>
                {internal.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </optgroup>
            )}
            {pub.length > 0 && (
              <optgroup label={t('groupPublic')}>
                {pub.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {courses.length === 0 && <p className="field__hint">{t('noCourses')}</p>}

        <Field label={t('due')} hint={t('dueHint')}>
          <Input type="date" name="due" min={minDate} value={due} onChange={(ev) => setDue(ev.target.value)} />
        </Field>

        {state?.status === 'error' && (
          <Alert tone="error">{t(`errors.${state.code}`, { max: maxAssign })}</Alert>
        )}
        {state?.status === 'success' && (
          <Alert tone="success">
            {t('success', { count: state.assigned })}
            {state.skipped > 0 && <> {t('skipped', { count: state.skipped })}</>}
          </Alert>
        )}

        <SubmitButton size="lg" block pending={pending} pendingText={t('pending')} disabled={!canSubmit}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}
