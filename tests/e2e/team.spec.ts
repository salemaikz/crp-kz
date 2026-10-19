import { expect, test, type Page } from '@playwright/test';

// «Команда»: доступ только руководителю, назначение курса сотруднику, отчёт и CSV.

async function demoLogin(page: Page, role: 'admin' | 'manager' | 'operator' | 'client') {
  await page.goto('/ru/login');
  await page.getByTestId(`demo-login-${role}`).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('гость: /ru/team ведёт на вход', async ({ page }) => {
  await page.goto('/ru/team');
  await expect(page).toHaveURL(/\/ru\/login\?next=%2Fru%2Fteam/);
});

test('не руководитель: раздел «Команда» не существует (404), CSV недоступен', async ({ page }) => {
  await demoLogin(page, 'operator');
  await expect(page).toHaveURL(/\/ru\/learn/);
  const res = await page.goto('/ru/team');
  expect(res?.status()).toBe(404);
  const csv = await page.request.get('/ru/team/report.csv');
  expect(csv.status()).toBe(404);
});

test('гость не получает CSV', async ({ request }) => {
  const res = await request.get('/ru/team/report.csv');
  expect(res.status()).toBe(401);
});

test('руководитель: назначает курс сотруднику — строка появляется в отчёте', async ({ page }) => {
  await demoLogin(page, 'manager');
  await expect(page).toHaveURL(/\/ru\/team/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Обучение вашей команды');

  // сводка и отчёт по внутреннему курсу из демо-данных
  await expect(page.getByText('Сотрудников', { exact: true })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.locator('tr', { hasText: 'Арман Бекенов' })).toContainText('Просрочено');

  // назначение: Ольга Павлова ещё не учится на «Как проходит бизнес-разбор»
  await expect(table.locator('tr', { hasText: 'Ольга Павлова' }).filter({ hasText: 'Как проходит бизнес-разбор' })).toHaveCount(0);
  const submit = page.getByRole('button', { name: 'Назначить курс' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /Ольга Павлова/ }).check();
  await page.locator('select[name="courseId"]').selectOption({ label: 'Как проходит бизнес-разбор' });
  await page.getByLabel('Срок прохождения').fill('2031-01-15');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Курс назначен 1 сотруднику')).toBeVisible();

  const row = table.locator('tr', { hasText: 'Ольга Павлова' }).filter({ hasText: 'Как проходит бизнес-разбор' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('В срок');
  await expect(row).toContainText('0 из 3 уроков');
  // выбор сброшен после успеха
  await expect(page.getByRole('checkbox', { name: /Ольга Павлова/ })).not.toBeChecked();
});

test('отчёт: фильтр по статусу и выгрузка CSV (BOM, «;»)', async ({ page }) => {
  await demoLogin(page, 'manager');
  await page.goto('/ru/team');
  await page.locator('select[name="status"]').selectOption('overdue');
  await expect(page).toHaveURL(/status=overdue/);
  const table = page.getByRole('table');
  await expect(table.locator('tbody tr')).toHaveCount(2); // Арман и Асель
  await expect(table).not.toContainText('Дмитрий Ким');

  const res = await page.request.get('/ru/team/report.csv?status=overdue');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['content-disposition']).toContain('attachment');
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const text = body.toString('utf8').replace(/^﻿/, '');
  const lines = text.trim().split('\r\n');
  expect(lines[0]).toBe('ФИО;Email;Должность;Курс;Прогресс %;Тест %;Срок;Статус;Сертификат');
  expect(lines).toHaveLength(3);
  expect(text).toContain('Арман Бекенов;arman.bekenov@crp.demo');
  expect(text).not.toContain('Дмитрий Ким');
});
