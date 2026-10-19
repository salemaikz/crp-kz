import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge, Card, EmptyState } from '@/components/ui';
import {
  addLessonAction,
  addModuleAction,
  deleteLessonAction,
  deleteModuleAction,
  moveLessonAction,
  moveModuleAction,
  renameModuleAction,
  setLessonStatusAction,
} from '@/lib/admin/actions';
import type { ModuleNode } from '@/lib/admin/structure';
import { t as l10n } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDuration } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { ActionButton } from './ActionButton';
import { AddLessonForm, AddModuleForm, ModuleTitle } from './ProgramForms';

type Props = { courseId: string; modules: ModuleNode[]; locale: Locale };

/** Программа курса: модули и уроки с управлением порядком, публикацией и удалением. */
export async function ProgramTree({ courseId, modules, locale }: Props) {
  const t = await getTranslations('admin.program');
  const tEnum = await getTranslations('admin.enums');

  let lessonNo = 0;
  const lessonsTotal = modules.reduce((n, m) => n + m.lessons.length, 0);
  const withoutKz = modules.reduce((n, m) => n + m.lessons.filter((l) => !l.hasKz).length, 0);

  return (
    <div className="adm-program">
      {withoutKz > 0 && (
        <p className="meta adm-program__kz" data-testid="program-kz-summary">
          {t('kzSummary', { missing: withoutKz, total: lessonsTotal })}
        </p>
      )}
      {modules.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyText')} headingLevel="h3" />
      ) : (
        modules.map((m, mi) => (
          <Card as="section" key={m.id} padding="none" className="adm-module" aria-label={l10n(m.title, locale)}>
            <header className="adm-module__head">
              <ModuleTitle
                action={renameModuleAction.bind(null, locale, m.id)}
                titleRu={m.title.ru}
                titleKz={m.title.kz ?? ''}
                label={`${t('module', { n: mi + 1 })} · ${t('lessonsCount', { count: m.lessons.length })}`}
              />
              <div className="adm-module__tools">
                <ActionButton
                  action={moveModuleAction.bind(null, locale, m.id, 'up')}
                  label={t('moduleActions.up')}
                  icon={<ArrowUp aria-hidden="true" />}
                  disabled={mi === 0}
                />
                <ActionButton
                  action={moveModuleAction.bind(null, locale, m.id, 'down')}
                  label={t('moduleActions.down')}
                  icon={<ArrowDown aria-hidden="true" />}
                  disabled={mi === modules.length - 1}
                />
                <ActionButton
                  action={deleteModuleAction.bind(null, locale, m.id)}
                  label={t('moduleActions.delete')}
                  icon={<Trash2 aria-hidden="true" />}
                  tone="danger"
                  disabled={m.lessons.length > 0}
                  disabledReason={t('moduleActions.deleteDisabled')}
                  confirm={t('moduleActions.deleteConfirm', { title: l10n(m.title, locale) })}
                />
              </div>
            </header>

            {m.lessons.length === 0 ? (
              <p className="adm-module__empty">{t('noLessons')}</p>
            ) : (
              <ol className="adm-lessons">
                {m.lessons.map((l, li) => {
                  lessonNo += 1;
                  const published = l.status === 'published';
                  const title = l10n(l.title, locale);
                  return (
                    <li key={l.id} className="adm-lesson" data-testid="lesson-row">
                      <span className="adm-lesson__num" aria-hidden="true">
                        {lessonNo}
                      </span>
                      <div className="adm-lesson__main">
                        <Link href={`/admin/courses/${courseId}/lessons/${l.id}`} className="adm-lesson__title">
                          {title}
                        </Link>
                        <div className="adm-lesson__meta">
                          <Badge tone={published ? 'success' : 'neutral'} dot>
                            {tEnum(`status.${l.status}`)}
                          </Badge>
                          <span>{l.durationMin > 0 ? formatDuration(l.durationMin, locale) : t('lesson.noDuration')}</span>
                          <span>{t('lesson.blocks', { count: l.blocksRu })}</span>
                          {!l.hasKz && (
                            <span className="adm-lesson__lang" title={t('lesson.ruOnlyTitle')}>
                              {t('lesson.ruOnly')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="adm-lesson__tools">
                        <ActionButton
                          variant="text"
                          action={setLessonStatusAction.bind(null, locale, l.id, published ? 'draft' : 'published')}
                          label={published ? t('lesson.unpublish') : t('lesson.publish')}
                          tone={published ? 'default' : 'primary'}
                          testId={published ? 'lesson-unpublish' : 'lesson-publish'}
                        />
                        <Link
                          href={`/admin/courses/${courseId}/lessons/${l.id}`}
                          className="adm-iconbtn"
                          aria-label={t('lesson.edit')}
                          title={t('lesson.edit')}
                        >
                          <Pencil aria-hidden="true" />
                        </Link>
                        <ActionButton
                          action={moveLessonAction.bind(null, locale, l.id, 'up')}
                          label={t('lesson.up')}
                          icon={<ArrowUp aria-hidden="true" />}
                          // первый урок модуля уходит в конец предыдущего модуля (даже пустого); двигать некуда только в начале курса
                          disabled={mi === 0 && li === 0}
                        />
                        <ActionButton
                          action={moveLessonAction.bind(null, locale, l.id, 'down')}
                          label={t('lesson.down')}
                          icon={<ArrowDown aria-hidden="true" />}
                          disabled={mi === modules.length - 1 && li === m.lessons.length - 1}
                        />
                        <ActionButton
                          action={deleteLessonAction.bind(null, locale, l.id)}
                          label={t('lesson.delete')}
                          icon={<Trash2 aria-hidden="true" />}
                          tone="danger"
                          confirm={t('lesson.deleteConfirm', { title })}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            <footer className="adm-module__foot">
              <AddLessonForm action={addLessonAction.bind(null, locale, m.id)} moduleId={m.id} />
            </footer>
          </Card>
        ))
      )}

      <Card tone="dashed" padding="md" as="section" aria-label={t('addModule.title')}>
        <AddModuleForm action={addModuleAction.bind(null, locale, courseId)} />
      </Card>
    </div>
  );
}
