import { expect, test } from '@playwright/test';

// Дымовой тест каркаса: локаль, шапка, демо-вход.

test('корень перенаправляет на /ru', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test('шапка видна: логотип, навигация, язык', async ({ page }) => {
  await page.goto('/ru');
  const header = page.getByRole('banner');
  await expect(header).toBeVisible();
  await expect(header.getByRole('link', { name: /Академия ЦРП/ })).toBeVisible();
  await expect(header.getByRole('navigation', { name: 'Язык интерфейса' })).toBeVisible();
});

test('казахская версия: lang="kk"', async ({ page }) => {
  await page.goto('/kz/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('страница входа показывает кнопки демо-доступа', async ({ page }) => {
  await page.goto('/ru/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const role of ['admin', 'manager', 'operator', 'client']) {
    await expect(page.getByTestId(`demo-login-${role}`)).toBeVisible();
  }
});

test('демо-вход клиентом ведёт в «Моё обучение»', async ({ page }) => {
  await page.goto('/ru/login');
  await page.getByTestId('demo-login-client').click();
  await expect(page).toHaveURL(/\/ru\/learn/);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Моё обучение' }).first()).toBeAttached();
});

test('страница входа ведёт по ссылке «Забыли пароль?» к восстановлению', async ({ page }) => {
  await page.goto('/ru/login');
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page).toHaveURL(/\/ru\/password\/forgot$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Восстановление пароля' })).toBeVisible();
});
