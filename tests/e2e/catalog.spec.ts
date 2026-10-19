import { expect, test, type Page } from '@playwright/test';

// Каталог и страница курса: гость, бесплатный курс, внутренний курс сотрудника, казахская версия.

async function demoLogin(page: Page, role: 'admin' | 'manager' | 'operator' | 'client', next?: string) {
  await page.goto(`/ru/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByTestId(`demo-login-${role}`).click();
  // вход завершён, когда ушли со страницы входа (иначе следующий goto прервёт отправку формы)
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('лендинг: первый экран, витрина курсов и блок для команд', async ({ page }) => {
  await page.goto('/ru');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Учитесь у практиков');
  await expect(page.getByRole('link', { name: 'Выбрать курс' }).first()).toHaveAttribute('href', '/ru/courses');
  await expect(page.getByRole('heading', { level: 2, name: 'С чего начать' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Целина', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /От выбора курса до сертификата/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Для сотрудников ЦРП' })).toBeVisible();
});

test('гость: каталог → «Целина» → на странице курса кнопка «Купить»', async ({ page }) => {
  await page.goto('/ru/courses');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Курсы');
  await page.getByRole('link', { name: 'Целина', exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/courses\/celina$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Целина' })).toBeVisible();
  const buy = page.getByRole('link', { name: 'Купить' }).first();
  await expect(buy).toBeVisible();
  await expect(buy).toHaveAttribute('href', '/ru/courses/celina/buy');
  // программа — только названия уроков; описание из markdown
  await expect(page.getByRole('heading', { level: 2, name: 'Программа курса' })).toBeVisible();
  await expect(page.getByText('Бизнес как система: продукт, клиент, деньги')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'О курсе' })).toBeVisible();
});

test('каталог: фильтры «Платные» и «Бесплатные»', async ({ page }) => {
  await page.goto('/ru/courses?f=paid');
  await expect(page.getByRole('link', { name: 'Целина', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Как проходит бизнес-разбор' })).toHaveCount(0);
  await page.goto('/ru/courses?f=free');
  await expect(page.getByRole('link', { name: 'Как проходит бизнес-разбор' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Целина', exact: true })).toHaveCount(0);
  // гостю «Для сотрудников» не показывается, внутренний курс не виден
  await expect(page.getByRole('link', { name: 'Для сотрудников' })).toHaveCount(0);
  await page.goto('/ru/courses');
  await expect(page.getByRole('link', { name: /Оператор ЦРП/ })).toHaveCount(0);
});

test('внутренний курс гостю не виден: страница курса отдаёт 404', async ({ page }) => {
  const res = await page.goto('/ru/courses/operator-onboarding');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Такой страницы нет');
  const missing = await page.goto('/ru/courses/net-takogo-kursa');
  expect(missing?.status()).toBe(404);
});

test('сотрудник ЦРП: в каталоге есть «Для сотрудников», внутренний курс — «Продолжить обучение»', async ({ page }) => {
  await demoLogin(page, 'operator');
  await page.goto('/ru/courses');
  await page.getByRole('link', { name: /Для сотрудников/ }).click();
  await expect(page).toHaveURL(/f=staff/);
  await page.getByRole('link', { name: /Оператор ЦРП/ }).click();
  await expect(page).toHaveURL(/\/ru\/courses\/operator-onboarding$/);
  await expect(page.getByRole('link', { name: 'Продолжить обучение' }).first()).toHaveAttribute(
    'href',
    '/ru/learn/operator-onboarding',
  );
});

test('бесплатный курс: гость идёт на вход и возвращается, «Начать бесплатно» открывает курс', async ({ page }) => {
  await page.goto('/ru/courses/razbor');
  await page.getByRole('button', { name: 'Начать бесплатно' }).first().click();
  await expect(page).toHaveURL(/\/ru\/login\?next=%2Fru%2Fcourses%2Frazbor/);
  await page.getByTestId('demo-login-operator').click();
  await expect(page).toHaveURL(/\/ru\/courses\/razbor$/);
  await page.getByRole('button', { name: 'Начать бесплатно' }).first().click();
  await expect(page).toHaveURL(/\/ru\/learn\/razbor/);
});

test('платный курс: вместо «Начать бесплатно» — «Купить»', async ({ page }) => {
  await demoLogin(page, 'operator');
  await page.goto('/ru/courses/sales-doubling');
  await expect(page.getByRole('button', { name: 'Начать бесплатно' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Купить' }).first()).toHaveAttribute('href', '/ru/courses/sales-doubling/buy');
});

test('казахская версия: заголовок и lang="kk"', async ({ page }) => {
  await page.goto('/kz/courses');
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Бизнес пен команданың өсуіне арналған курстар');
  await page.goto('/kz/courses/celina');
  await expect(page.getByRole('link', { name: 'Сатып алу' }).first()).toBeVisible();
});
