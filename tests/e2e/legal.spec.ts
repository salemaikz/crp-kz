import { expect, test } from '@playwright/test';

// Юридические документы (LEGAL, в демо включён): подвал, страницы, черновики, 404.

test('гость: подвал, колонка «Документы», оферта с пометкой черновика', async ({ page }) => {
  await page.goto('/ru');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('heading', { level: 2, name: 'Документы' })).toBeVisible();
  await footer.getByRole('link', { name: 'Публичная оферта' }).click();
  await expect(page).toHaveURL(/\/ru\/legal\/offer$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Публичная оферта' })).toBeVisible();
  await expect(page.getByText('Редакция от 20 октября 2026')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Черновик, не действует' })).toBeVisible();
  await expect(page.getByText('[заполняет юрист ЦРП]').first()).toBeVisible();
});

test('список документов: четыре документа, у каждого пометка «Черновик»', async ({ page }) => {
  await page.goto('/ru/legal');
  await expect(page.getByRole('heading', { level: 1, name: 'Документы' })).toBeVisible();
  for (const name of [
    'Публичная оферта',
    'Политика обработки персональных данных',
    'Согласие на сбор и обработку персональных данных',
    'Условия возврата',
  ]) {
    await expect(page.getByRole('main').getByRole('link', { name })).toBeVisible();
  }
  await expect(page.getByRole('main').getByText('Черновик', { exact: true })).toHaveCount(4);
});

test('казахская версия документа открывается', async ({ page }) => {
  const res = await page.goto('/kz/legal/privacy');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Дербес деректерді өңдеу саясаты' })).toBeVisible();
});

test('неизвестный документ и неизвестная редакция — 404', async ({ page }) => {
  for (const url of ['/ru/legal/unknown', '/ru/legal/offer/1999-01-01', '/ru/legal/OFFER', '/ru/legal/pd_consent']) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
  }
});

test('редакция по номеру версии открывается', async ({ page }) => {
  const res = await page.goto('/ru/legal/refund/2026-10-20');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Условия возврата' })).toBeVisible();
});
