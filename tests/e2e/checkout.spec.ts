import { expect, test } from '@playwright/test';

// Покупка, Фаза 0 (D-007, D-020): гость → вход/регистрация → оформление заказа на свой аккаунт →
// админ (демо) подтверждает оплату → заказ оплачен, доступ открыт. Покупатель — новый аккаунт:
// сценарий не зависит от состояния демо-клиента и повторяется (retries в CI).

test('гость: «Войти и купить» → регистрация → заказ «Удвоение личных продаж» через Kaspi → админ подтверждает', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.kz`;

  // гостю на странице курса — вход перед покупкой, с возвратом к форме
  await page.goto('/ru/courses/sales-doubling');
  const cta = page.getByRole('link', { name: 'Войти и купить' }).first();
  await expect(cta).toHaveAttribute('href', '/ru/login?next=%2Fru%2Fcourses%2Fsales-doubling%2Fbuy');

  // прямой заход на форму покупки без входа — тоже на вход
  await page.goto('/ru/courses/sales-doubling/buy');
  await expect(page).toHaveURL(/\/ru\/login\?next=%2Fru%2Fcourses%2Fsales-doubling%2Fbuy$/);

  // аккаунта нет — регистрация, затем сразу форма покупки
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/ru\/register\?next=/);
  await page.getByLabel('Имя и фамилия').fill('Тест Покупатель');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill('e2e-password-123');
  await page.getByLabel(/Согласен\(на\) на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page).toHaveURL(/\/ru\/courses\/sales-doubling\/buy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Удвоение личных продаж' })).toBeVisible();
  await expect(page.getByText('49 000 ₸').first()).toBeVisible();
  // имя — из аккаунта, email — email аккаунта, его не меняют
  await expect(page.getByLabel('Имя и фамилия')).toHaveValue('Тест Покупатель');
  const emailField = page.getByLabel('Email');
  await expect(emailField).toHaveValue(email);
  await expect(emailField).toHaveAttribute('readonly', '');

  await page.getByLabel('Телефон').fill('8 701 100 09 29');
  await expect(page.getByRole('radio', { name: /^Kaspi/ })).toBeChecked();

  // без согласия заказ не создаётся, введённое сохраняется
  await page.getByRole('button', { name: /Оформить заказ/ }).click();
  await expect(page.getByText('Без согласия мы не можем оформить заказ.')).toBeVisible();
  await expect(page.getByLabel('Телефон')).toHaveValue('8 701 100 09 29');
  await expect(page.getByLabel('Email')).toHaveValue(email);

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

  // повторный заход на покупку: открытый заказ, второй не нужен
  await page.goto('/ru/courses/sales-doubling/buy');
  await expect(page.getByText(`У вас уже есть неоплаченный заказ ${number}`)).toBeVisible();

  // демо: вход администратором в один клик → «Заказы»
  await page.goto(orderUrl);
  await page.getByTestId('demo-admin-hint').getByRole('button', { name: 'Войти как администратор' }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/orders/);
  await expect(page.getByRole('heading', { level: 1, name: 'Заказы' })).toBeVisible();

  await page.getByTestId(`mark-paid-${number}`).click();
  await page.getByTestId(`confirm-paid-${number}`).click();
  await expect(page.getByRole('status').filter({ hasText: `Заказ ${number} оплачен` })).toBeVisible();

  // статус на странице заказа (по той же ссылке с ключом); админ — не владелец, ему «войти»
  await page.goto(orderUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Оплата получена, доступ открыт' })).toBeVisible();
  await expect(page.getByTestId('order-paid')).toBeVisible();
  await expect(page.getByTestId('order-paid')).not.toContainText('установки пароля');
});

test('чужой заказ без ключа не открывается, бесплатный курс не продаётся', async ({ page }) => {
  const res = await page.goto('/ru/orders/DEMO-1002');
  expect(res?.status()).toBe(404);
  const bad = await page.goto('/ru/orders/DEMO-1002?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  expect(bad?.status()).toBe(404);

  await page.goto('/ru/courses/razbor/buy');
  await expect(page).toHaveURL(/\/ru\/courses\/razbor$/);
});
