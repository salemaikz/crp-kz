import { expect, test, type Page } from '@playwright/test';

// Напоминания (D-033) в демо: админ формирует их кнопкой в «Письмах». В сиде уже есть сроки:
// две просроченные записи, одна со скорым сроком и руководитель manager@crp.demo.
// Заодно: страница за последней в «Письмах» и кнопка ссылки для смены пароля в карточке пользователя.

async function loginAsAdmin(page: Page) {
  await page.goto('/ru/login');
  await page.getByTestId('demo-login-admin').click();
  await expect(page).toHaveURL(/\/ru\/admin/);
}

test('напоминания: кнопка в «Письмах» ставит письма, повторное нажатие — «Новых напоминаний нет»', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ru/admin/mail');

  await page.getByTestId('run-reminders-button').click();
  const result = page.getByTestId('run-reminders-result');
  await expect(result).toContainText('Поставлено в очередь');
  await expect(result).toContainText(/напоминаний сотрудникам — [1-9]\d*/);
  await expect(result).toContainText(/сводок руководителям — [1-9]\d*/);

  // письма видны в списке: «Срок прошёл» и «Сводка руководителю»
  await page.goto('/ru/admin/mail');
  await expect(page.getByRole('row').filter({ hasText: 'Срок прошёл' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Сводка руководителю' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'manager@crp.demo' }).first()).toBeVisible();

  // повторное нажатие: ничего нового
  await page.getByTestId('run-reminders-button').click();
  await expect(page.getByTestId('run-reminders-result')).toHaveText(/Новых напоминаний нет/);
});

test('«Письма»: страница за последней показывает последнюю, а не «Писем пока нет»', async ({ page }) => {
  await loginAsAdmin(page);
  // гарантируем, что в очереди есть письма, даже если тест запущен отдельно
  await page.goto('/ru/admin/mail');
  await page.getByTestId('run-reminders-button').click();
  await expect(page.getByTestId('run-reminders-result')).toBeVisible();
  await page.goto('/ru/admin/mail?page=9999');
  await expect(page.getByRole('heading', { level: 1, name: 'Письма' })).toBeVisible();
  await expect(page.getByText('Писем пока нет.')).toHaveCount(0);
  await expect(page.getByTestId('mail-open').first()).toBeVisible();
});

test('карточка пользователя: ссылка для смены пароля — демо-аккаунту отказ, новому аккаунту «поставлено в очередь»', async ({ page, browser }) => {
  // новый аккаунт: у демо-аккаунтов из сида пароль в демо не меняется
  const email = `e2e-link-${Date.now()}@example.kz`;
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto('/ru/register');
  await guest.getByLabel('Имя и фамилия').fill('Тест Ссылка');
  await guest.getByLabel('Email').fill(email);
  await guest.locator('input[name="password"]').fill('e2e-link-password-1');
  await guest.getByLabel(/Даю согласие на сбор и обработку/).check();
  await guest.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(guest).toHaveURL(/\/ru\/learn/);
  await context.close();

  await loginAsAdmin(page);

  // демо-аккаунт из сида: понятный отказ, «поставлено в очередь» нет
  await page.goto('/ru/admin/users?q=operator@');
  await page.getByRole('link', { name: /Айгерим/ }).first().click();
  await page.getByTestId('send-reset-button').click();
  await expect(page.getByTestId('send-reset-failed')).toContainText('демо-аккаунт');
  await expect(page.getByTestId('send-reset-done')).toHaveCount(0);

  // новый аккаунт: письмо поставлено, оно видно в «Письмах»
  await page.goto(`/ru/admin/users?q=${encodeURIComponent(email)}`);
  await page.getByRole('link', { name: /Тест Ссылка/ }).first().click();
  await page.getByTestId('send-reset-button').click();
  await expect(page.getByTestId('send-reset-done')).toHaveText(/Письмо поставлено в очередь/);
  await page.goto('/ru/admin/mail');
  await expect(page.getByRole('row').filter({ hasText: email }).filter({ hasText: 'Сброс пароля' }).first()).toBeVisible();

  // блок «Согласия»: в демо LEGAL включён, регистрация записала согласие
  await page.goto(`/ru/admin/users?q=${encodeURIComponent(email)}`);
  await page.getByRole('link', { name: /Тест Ссылка/ }).first().click();
  await expect(page.getByTestId('user-consents')).toBeVisible();
  await expect(page.getByTestId('consent-row').first()).toContainText('Обработка ПДн');
});
