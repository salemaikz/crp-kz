import { expect, test } from '@playwright/test';

// Покупка, Фаза 0 (D-007): гость оформляет заказ → админ (демо) подтверждает оплату → заказ оплачен.

test('гость покупает «Удвоение личных продаж» через Kaspi, админ подтверждает оплату', async ({ page }) => {
  await page.goto('/ru/courses/sales-doubling/buy');
  await expect(page.getByRole('heading', { level: 1, name: 'Удвоение личных продаж' })).toBeVisible();
  await expect(page.getByText('49 000 ₸').first()).toBeVisible();

  await page.getByLabel('Имя и фамилия').fill('Тест Покупатель');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.kz`);
  await page.getByLabel('Телефон').fill('8 701 100 09 29');
  await expect(page.getByRole('radio', { name: /^Kaspi/ })).toBeChecked();

  // без согласия заказ не создаётся, введённое сохраняется
  await page.getByRole('button', { name: /Оформить заказ/ }).click();
  await expect(page.getByText('Без согласия мы не можем оформить заказ.')).toBeVisible();
  await expect(page.getByLabel('Имя и фамилия')).toHaveValue('Тест Покупатель');

  await page.getByLabel(/Принимаю условия публичной оферты/).check();
  await page.getByRole('button', { name: /Оформить заказ/ }).click();

  await expect(page).toHaveURL(/\/ru\/orders\/CRP-\d{6}-\d{4}\?key=[\w-]{32}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Оплатите заказ через Kaspi' })).toBeVisible();
  await expect(page.getByTestId('kaspi-qr-placeholder')).toContainText(
    'QR Kaspi появится после подключения ЦРП к Kaspi Pay',
  );
  await expect(page.getByText('ТОО «Центр развития предпринимателей»').first()).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  expect(number).toMatch(/^CRP-\d{6}-\d{4}$/);
  const orderUrl = page.url();

  // демо: вход администратором в один клик → «Заказы»
  await page.getByTestId('demo-admin-hint').getByRole('button', { name: 'Войти как администратор' }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/orders/);
  await expect(page.getByRole('heading', { level: 1, name: 'Заказы' })).toBeVisible();

  await page.getByTestId(`mark-paid-${number}`).click();
  await page.getByTestId(`confirm-paid-${number}`).click();
  await expect(page.getByRole('status').filter({ hasText: `Заказ ${number} оплачен` })).toBeVisible();

  // статус на странице заказа (по той же ссылке с ключом)
  await page.goto(orderUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Оплата получена, доступ открыт' })).toBeVisible();
  await expect(page.getByTestId('order-paid')).toBeVisible();
});

test('чужой заказ без ключа не открывается, бесплатный курс не продаётся', async ({ page }) => {
  const res = await page.goto('/ru/orders/DEMO-1002');
  expect(res?.status()).toBe(404);
  const bad = await page.goto('/ru/orders/DEMO-1002?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  expect(bad?.status()).toBe(404);

  await page.goto('/ru/courses/razbor/buy');
  await expect(page).toHaveURL(/\/ru\/courses\/razbor$/);
});
