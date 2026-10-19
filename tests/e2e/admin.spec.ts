import { expect, test, type Page } from '@playwright/test';

// Админка: вход демо-админом, конструктор курса (курс → модуль → урок с текстовым блоком → публикация),
// проверка ошибок теста и выдача доступа из карточки пользователя.

async function loginAsAdmin(page: Page) {
  await page.goto('/ru/login');
  await page.getByTestId('demo-login-admin').click();
  await expect(page).toHaveURL(/\/ru\/admin/);
}

test('гость и не-админ не видят админку', async ({ page }) => {
  await page.goto('/ru/admin');
  await expect(page).toHaveURL(/\/ru\/login\?next=%2Fru%2Fadmin$/);

  await page.goto('/ru/login');
  await page.getByTestId('demo-login-client').click();
  await expect(page).toHaveURL(/\/ru\/learn/);
  // страница отвечает как несуществующая (при потоковой отдаче статус уже 200, но содержимого админки нет)
  await page.goto('/ru/admin/courses');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
  await expect(page.getByTestId('admin-nav-courses')).toHaveCount(0);
  await page.goto('/ru/admin/mail');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
});

test('письма: пункт меню, режим демо, письмо открывается', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByTestId('admin-nav-mail')).toHaveText('Письма');
  await page.getByTestId('admin-nav-mail').click();
  await expect(page).toHaveURL(/\/ru\/admin\/mail$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Письма' })).toBeVisible();
  await expect(page.getByTestId('mail-mode')).toContainText('Демо-версия: письма не отправляются');
  // фильтр по статусу не ломает страницу; неизвестный статус игнорируется
  await page.goto('/ru/admin/mail?status=sent');
  await expect(page.getByRole('heading', { level: 1, name: 'Письма' })).toBeVisible();
  await page.goto('/ru/admin/mail?status=nope&page=abc');
  await expect(page.getByRole('heading', { level: 1, name: 'Письма' })).toBeVisible();
  // несуществующее письмо — 404
  await page.goto('/ru/admin/mail/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
});

test('сводка: цифры, меню и журнал действий', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const id of ['users', 'courses', 'enrollments', 'pending', 'certificates']) {
    await expect(page.getByTestId(`stat-${id}`)).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: 'Разделы админки' });
  await expect(nav.getByRole('link', { name: /Курсы/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Заказы/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Последние действия' })).toBeVisible();
  // «Заказы ждут оплаты» ведёт на страницу заказов
  await expect(page.getByTestId('stat-pending')).toHaveAttribute('href', /\/ru\/admin\/orders$/);
});

test('конструктор: курс → модуль → урок с текстом → публикация', async ({ page }) => {
  const title = `E2E Курс ${Date.now()}`;
  await loginAsAdmin(page);

  // создание курса
  await page.goto('/ru/admin/courses');
  await page.getByTestId('create-course').click();
  await expect(page).toHaveURL(/\/admin\/courses\/new$/);
  await page.getByLabel('Название — русский').fill(title);
  await page.getByLabel('Название — казахский').fill('E2E курс (қазақша)');
  await page.getByLabel('Цена, ₸').fill('12000');
  await page.getByTestId('course-submit').click();
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('В курсе пока нет модулей')).toBeVisible();

  // публиковать курс без уроков нельзя
  await page.getByTestId('course-toggle-status').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Нельзя опубликовать курс без опубликованных уроков' })).toBeVisible();

  // модуль
  const moduleForm = page.getByTestId('add-module-form');
  await moduleForm.getByLabel('Название — русский').fill('Введение');
  await moduleForm.getByRole('button', { name: 'Добавить модуль' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Введение' })).toBeVisible();

  // урок
  await page.getByRole('button', { name: 'Добавить урок' }).click();
  const lessonForm = page.getByTestId('add-lesson-form');
  await lessonForm.getByLabel('Название урока — русский').fill('Первый урок');
  await lessonForm.getByLabel('Минут').fill('10');
  await lessonForm.getByRole('button', { name: 'Добавить урок' }).click();
  const row = page.getByTestId('lesson-row').filter({ hasText: 'Первый урок' });
  await expect(row).toBeVisible();

  // пустой урок опубликовать нельзя
  await row.getByTestId('lesson-publish').click();
  await expect(row.getByRole('alert')).toContainText('Нельзя опубликовать пустой урок');

  // редактор: текстовый блок с предпросмотром и сохранение
  await row.getByRole('link', { name: 'Первый урок' }).click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/);
  await page.getByTestId('add-block-text').first().click();
  await page.getByLabel('Текст (Markdown)').fill('Привет, **слушатель**!\n\n- пункт один\n- пункт два');
  await expect(page.locator('.adm-split__paper strong')).toHaveText('слушатель');
  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();

  // предпросмотр урока
  await page.getByTestId('mode-preview').click();
  await expect(page.locator('.adm-preview-card').getByText('пункт два')).toBeVisible();

  // публикация урока и курса
  await page.goto(page.url().replace(/\/lessons\/.*$/, ''));
  const row2 = page.getByTestId('lesson-row').filter({ hasText: 'Первый урок' });
  await row2.getByTestId('lesson-publish').click();
  await expect(row2.getByText('Опубликован', { exact: true })).toBeVisible();
  await page.getByTestId('course-toggle-status').click();
  await expect(page.getByTestId('course-toggle-status')).toContainText('Снять с публикации');

  // курс появился в списке админки как опубликованный
  await page.goto('/ru/admin/courses');
  const listRow = page.getByRole('row').filter({ hasText: title });
  await expect(listRow).toBeVisible();
  await expect(listRow).toContainText('Опубликован');
  await expect(listRow).toContainText(/12\s000/);

  // каталог (страницу делает другой поток; пока там заглушка — пропускаем проверку)
  await page.goto('/ru/courses');
  const catalogReady = (await page.getByText('Раздел в разработке').count()) === 0;
  if (catalogReady) await expect(page.getByText(title).first()).toBeVisible();
});

test('редактор урока: ошибки теста показываются у блока и пропадают после исправления', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ru/admin/courses');
  await page.getByRole('link', { name: 'Как проходит бизнес-разбор' }).first().click();
  await page.getByTestId('lesson-row').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/lessons\//);

  await page.getByTestId('add-block-quiz').first().click();
  await page.getByTestId('lesson-save').click();
  const block = page.locator('.adm-block--invalid');
  await expect(block).toBeVisible();
  await expect(block.getByRole('alert')).toContainText('Вопрос 1');
  await expect(page.getByText(/Нужно исправить/)).toBeVisible();

  // исправляем: текст вопроса и два варианта — ошибка исчезает (живая проверка по той же схеме)
  const quiz = page.locator('.adm-block[data-block-type="quiz"]');
  await quiz.getByLabel('Текст вопроса').fill('Сколько будет 2+2?');
  await quiz.getByLabel('Вариант 1', { exact: true }).fill('3');
  await quiz.getByLabel('Вариант 2', { exact: true }).fill('4');
  await expect(page.locator('.adm-block--invalid')).toHaveCount(0);
});

test('пользователи: поиск, выдача и отзыв доступа', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ru/admin/users');
  await page.getByTestId('user-search').fill('operator@');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page).toHaveURL(/q=operator/);
  await page.getByRole('link', { name: /Айгерим/ }).first().click();
  await expect(page.getByTestId('user-email')).toHaveText('operator@crp.demo');

  // выдать доступ к платному курсу на 30 дней
  const grant = page.getByTestId('grant-form');
  await grant.getByLabel('Курс').selectOption({ label: 'Целина' });
  await grant.getByLabel('Срок, дней').fill('30');
  await page.getByTestId('grant-submit').click();
  await expect(grant.getByText('Доступ выдан')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Целина' });
  await expect(row).toContainText('Выдан вручную');
  await expect(row).toContainText('Действует');

  // отозвать (подтверждение — системный диалог)
  page.once('dialog', (d) => d.accept());
  await row.getByTestId('revoke-access').click();
  await expect(row).toContainText('Отозван');
});

/** Создаёт черновик курса через форму и возвращает адрес его страницы. */
async function createCourse(page: Page, title: string): Promise<string> {
  await page.goto('/ru/admin/courses/new');
  await page.getByLabel('Название — русский').fill(title);
  await page.getByTestId('course-submit').click();
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

async function addModule(page: Page, title: string) {
  const form = page.getByTestId('add-module-form');
  await form.getByLabel('Название — русский').fill(title);
  await form.getByRole('button', { name: 'Добавить модуль' }).click();
  await expect(page.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible();
}

test('структура: порядок модулей и уроков, переименование, удаление', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await loginAsAdmin(page);
  await createCourse(page, `E2E Структура ${Date.now()}`);

  await addModule(page, 'Альфа');
  await addModule(page, 'Бета');
  const names = () => page.locator('.adm-module__name h3').allTextContents();
  expect(await names()).toEqual(['Альфа', 'Бета']);

  // «Бета» выше «Альфы»
  await page.getByRole('region', { name: 'Бета' }).getByRole('button', { name: 'Модуль выше' }).click();
  await expect.poll(names).toEqual(['Бета', 'Альфа']);

  // переименование
  const alpha = page.getByRole('region', { name: 'Альфа' });
  await alpha.getByRole('button', { name: 'Переименовать модуль' }).click();
  await alpha.getByLabel('Название — русский').fill('Альфа-2');
  await alpha.getByRole('button', { name: 'Сохранить' }).click();
  await expect.poll(names).toEqual(['Бета', 'Альфа-2']);

  // два урока в «Бете», второй поднимаем выше
  const beta = page.getByRole('region', { name: 'Бета' });
  for (const title of ['Урок один', 'Урок два']) {
    await beta.getByRole('button', { name: 'Добавить урок' }).click();
    await beta.getByLabel('Название урока — русский').fill(title);
    await beta.getByTestId('add-lesson-form').getByRole('button', { name: 'Добавить урок' }).click();
    await expect(beta.getByTestId('lesson-row').filter({ hasText: title })).toBeVisible();
  }
  const lessons = () => page.getByRole('region', { name: 'Бета' }).locator('.adm-lesson__title').allTextContents();
  expect(await lessons()).toEqual(['Урок один', 'Урок два']);
  await beta.getByTestId('lesson-row').filter({ hasText: 'Урок два' }).getByRole('button', { name: 'Урок выше' }).click();
  await expect.poll(lessons).toEqual(['Урок два', 'Урок один']);

  // первый урок модуля «Альфа-2» «вверх» не двигается дальше начала курса; а вот последний урок «Беты» «вниз» уходит в «Альфа-2»
  await beta.getByTestId('lesson-row').filter({ hasText: 'Урок один' }).getByRole('button', { name: 'Урок ниже' }).click();
  await expect(page.getByRole('region', { name: 'Альфа-2' }).getByText('Урок один')).toBeVisible();

  // модуль с уроками удалить нельзя, пустой — можно
  await expect(page.getByRole('region', { name: 'Альфа-2' }).getByRole('button', { name: 'Удалить модуль' })).toBeDisabled();
  await page.getByRole('region', { name: 'Альфа-2' }).getByTestId('lesson-row').getByRole('button', { name: 'Удалить урок' }).click();
  await expect(page.getByText('Урок один')).toHaveCount(0);
  await page.getByRole('region', { name: 'Альфа-2' }).getByRole('button', { name: 'Удалить модуль' }).click();
  await expect.poll(names).toEqual(['Бета']);
});

test('казахская версия урока: копия из RU сохраняется и переживает перезагрузку', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await loginAsAdmin(page);
  const coursePath = await createCourse(page, `E2E Перевод ${Date.now()}`);
  await addModule(page, 'Модуль');
  await page.getByRole('button', { name: 'Добавить урок' }).click();
  await page.getByTestId('add-lesson-form').getByLabel('Название урока — русский').fill('Урок');
  await page.getByTestId('add-lesson-form').getByRole('button', { name: 'Добавить урок' }).click();
  // пока казахской версии нет: сводка над программой и пометка «RU» у урока
  await expect(page.getByTestId('program-kz-summary')).toHaveText('Без казахской версии: 1 из 1 урока');
  await expect(page.getByTestId('lesson-row')).toContainText('RU');
  await page.getByTestId('lesson-row').getByRole('link', { name: 'Урок' }).first().click();

  await page.getByTestId('add-block-callout').first().click();
  await page.locator('.adm-block[data-block-type="callout"]').getByLabel('Текст выноски').fill('Важное правило');
  await page.getByRole('tab', { name: /ҚАЗ/ }).click();
  await page.getByTestId('copy-from-ru').click();
  await page.locator('.adm-block[data-locale="kz"], [data-locale="kz"] .adm-block').getByLabel('Текст выноски').fill('Маңызды ереже');
  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: /ҚАЗ/ })).toContainText('1');
  await page.getByRole('tab', { name: /ҚАЗ/ }).click();
  await expect(page.getByLabel('Текст выноски').filter({ visible: true })).toHaveValue('Маңызды ереже');

  // в программе сводка и пометка «RU» исчезли: у единственного урока есть казахская версия
  await page.goto(coursePath);
  await expect(page.getByTestId('lesson-row')).toHaveCount(1);
  await expect(page.getByTestId('program-kz-summary')).toHaveCount(0);
  await expect(page.getByTestId('lesson-row')).not.toContainText('RU');
});

test('казахская версия урока: лишний тест после удаления в RU и недостающий тест — исправление в один клик', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await loginAsAdmin(page);
  await createCourse(page, `E2E Тесты ҚАЗ ${Date.now()}`);
  await addModule(page, 'Модуль');
  await page.getByRole('button', { name: 'Добавить урок' }).click();
  await page.getByTestId('add-lesson-form').getByLabel('Название урока — русский').fill('Урок с тестом');
  await page.getByTestId('add-lesson-form').getByRole('button', { name: 'Добавить урок' }).click();
  await page.getByTestId('lesson-row').getByRole('link', { name: 'Урок с тестом' }).first().click();

  const visible = (sel: string) => page.locator(sel).filter({ visible: true });
  const fillQuiz = async (text: string) => {
    const quiz = visible('.adm-block[data-block-type="quiz"]').last();
    await quiz.getByLabel('Текст вопроса').fill(text);
    await quiz.getByLabel('Вариант 1', { exact: true }).fill('Да');
    await quiz.getByLabel('Вариант 2', { exact: true }).fill('Нет');
  };

  // RU: выноска и тест; ҚАЗ — копия с переводом выноски
  await page.getByTestId('add-block-callout').first().click();
  await visible('.adm-block[data-block-type="callout"]').getByLabel('Текст выноски').fill('Важное правило');
  await page.getByTestId('add-block-quiz').first().click();
  await fillQuiz('Первый вопрос');
  await page.getByRole('tab', { name: /ҚАЗ/ }).click();
  await page.getByTestId('copy-from-ru').click();
  await visible('.adm-block[data-block-type="callout"]').getByLabel('Текст выноски').fill('Маңызды ереже');
  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();

  // тест удалили в RU → сохранение объясняет, что делать, и чинит в один клик
  await page.getByRole('tab', { name: /РУС/ }).click();
  await visible('.adm-block[data-block-type="quiz"]').getByRole('button', { name: 'Удалить блок' }).click();
  await page.getByTestId('lesson-save').click();
  const error = page.getByTestId('kz-quiz-error');
  await expect(error).toContainText('удалите тест с тем же id в казахской версии');
  await expect(page.getByRole('tab', { name: /ҚАЗ/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('kz-quiz-error-remove-extra').click();
  await expect(error).toHaveCount(0);
  await expect(visible('.adm-block[data-block-type="quiz"]')).toHaveCount(0);
  await expect(visible('.adm-block[data-block-type="callout"]').getByLabel('Текст выноски')).toHaveValue('Маңызды ереже');
  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();

  // новый тест в RU → на вкладке ҚАЗ подсказка и кнопка «Добавить недостающие тесты из RU»
  await page.getByRole('tab', { name: /РУС/ }).click();
  await page.getByTestId('add-block-quiz').first().click();
  await fillQuiz('Новый вопрос');
  await page.getByRole('tab', { name: /ҚАЗ/ }).click();
  await expect(page.getByTestId('kz-quiz-hint')).toBeVisible();
  await page.getByTestId('add-missing-quizzes').click();
  await expect(page.getByTestId('kz-quiz-hint')).toHaveCount(0);
  await expect(page.getByTestId('add-missing-quizzes')).toBeDisabled();
  // перевод на месте, тест дописан с русским текстом как заготовкой
  await expect(visible('.adm-block[data-block-type="callout"]').getByLabel('Текст выноски')).toHaveValue('Маңызды ереже');
  await expect(visible('.adm-block[data-block-type="quiz"]').getByLabel('Текст вопроса')).toHaveValue('Новый вопрос');
  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();
});
