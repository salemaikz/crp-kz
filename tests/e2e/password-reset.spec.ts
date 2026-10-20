import { expect, test, type Browser, type Page } from '@playwright/test';
import { openLatestMailLink } from './helpers/mail';

// Сброс пароля (D-031): «Забыли пароль?» → письмо в «Письмах» (демо) → новый пароль → вход.
// Пользователь — новый аккаунт без покупки: демо-аккаунты из сида сбросу не подлежат.

const OLD_PASSWORD = 'e2e-old-password-1';
const NEW_PASSWORD = 'e2e-new-password-2';

test('сброс пароля: письмо, новый пароль, вход только с новым, повторная ссылка не работает', async ({ page, browser, context }) => {
  const email = `e2e-reset-${Date.now()}@example.kz`;

  // новый пользователь без покупки
  await page.goto('/ru/register');
  await page.getByLabel('Имя и фамилия').fill('Тест Сброс');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill(OLD_PASSWORD);
  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);

  // выход, «Забыли пароль?»
  await context.clearCookies();
  await page.goto('/ru/login');
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page).toHaveURL(/\/ru\/password\/forgot$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Получить ссылку' }).click();
  await expect(page.getByTestId('forgot-sent')).toContainText(`Если аккаунт с адресом ${email} есть`);

  // письмо — в «Письмах» (демо), ссылка из него
  const link = await openLatestMailLink(browser, { to: email, template: 'password_reset' });
  expect(link).toMatch(/^\/ru\/password\/reset#token=[\w-]{43}$/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/ru\/password\/reset$/); // токен убран из адреса
  await page.locator('input[name="password"]').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByTestId('reset-done')).toContainText('Пароль изменён. Вы вошли в аккаунт.');
  await page.getByRole('link', { name: 'Перейти к обучению' }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);

  // старый пароль больше не подходит, новый — да
  await context.clearCookies();
  await page.goto('/ru/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  await page.locator('input[name="password"]').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);

  // та же ссылка повторно
  await page.goto(link);
  await page.locator('input[name="password"]').fill('e2e-third-password-3');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Ссылка устарела или уже использована')).toBeVisible();
});

test('сброс пароля: страница без токена предлагает запросить новую ссылку', async ({ page }) => {
  await page.goto('/ru/password/reset');
  await expect(page.getByText('Ссылка неполная')).toBeVisible();
  await page.getByRole('link', { name: 'Запросить новую ссылку' }).click();
  await expect(page).toHaveURL(/\/ru\/password\/forgot$/);
});

test('сброс пароля: демо-аккаунт из сида получает тот же ответ, пароль не меняется', async ({ page }) => {
  await page.goto('/ru/password/forgot');
  await page.getByLabel('Email').fill('client@crp.demo');
  await page.getByRole('button', { name: 'Получить ссылку' }).click();
  await expect(page.getByTestId('forgot-sent')).toContainText('Если аккаунт с адресом client@crp.demo есть');
  // демо-пароль по-прежнему рабочий
  await page.goto('/ru/login');
  await page.getByLabel('Email').fill('client@crp.demo');
  await page.locator('input[name="password"]').fill('demo12345');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);
});

test('подтверждение email: плашка, «Отправить письмо», ссылка из «Писем», «Подтвердить email», плашка исчезла', async ({ page, browser }) => {
  const email = `e2e-verify-${Date.now()}@example.kz`;
  await page.goto('/ru/register');
  await page.getByLabel('Имя и фамилия').fill('Тест Подтверждение');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill(OLD_PASSWORD);
  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);

  const notice = page.getByTestId('verify-notice');
  await expect(notice).toContainText(`Подтвердите email ${email}`);
  await notice.getByRole('button', { name: 'Отправить письмо' }).click();
  await expect(page.getByTestId('verify-resent')).toBeVisible();

  const link = await openLatestMailLink(browser, { to: email, template: 'email_verify' });
  expect(link).toMatch(/^\/ru\/account\/verify#token=[\w-]{43}&next=%2Fru%2Flearn$/);
  // на GET ничего не тратится: страница открывается и ждёт нажатия
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Подтвердить email' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить email' }).click();
  // в ссылке есть next: после подтверждения возвращаемся туда, где просили письмо
  await expect(page).toHaveURL(/\/ru\/learn$/);
  // плашка в общем layout исчезает
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);

  await page.goto('/ru/learn');
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);
});

/** Регистрация нового пользователя и письмо подтверждения; возвращает токен из ссылки. */
async function registerAndGetVerifyToken(page: Page, browser: Browser, tag: string): Promise<string> {
  const email = `e2e-verify-${tag}-${Date.now()}@example.kz`;
  await page.goto('/ru/register');
  await page.getByLabel('Имя и фамилия').fill('Тест Переход');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill(OLD_PASSWORD);
  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/ru\/learn/);
  await page.getByTestId('verify-notice').getByRole('button', { name: 'Отправить письмо' }).click();
  await expect(page.getByTestId('verify-resent')).toBeVisible();
  const link = await openLatestMailLink(browser, { to: email, template: 'email_verify' });
  const token = /#token=([\w-]{43})/.exec(link)?.[1];
  expect(token).toBeTruthy();
  return token as string;
}

test('подтверждение email: next=/ru/courses — переход в каталог, плашки нет', async ({ page, browser }) => {
  const token = await registerAndGetVerifyToken(page, browser, 'next');
  await page.goto(`/ru/account/verify#token=${token}&next=${encodeURIComponent('/ru/courses')}`);
  await page.getByRole('button', { name: 'Подтвердить email' }).click();
  await expect(page).toHaveURL(/\/ru\/courses$/);
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);
});

test('подтверждение email: next=//evil.example/x не уводит с сайта (safeNext)', async ({ page, browser }) => {
  const token = await registerAndGetVerifyToken(page, browser, 'evil');
  const origin = new URL(page.url()).origin;
  await page.goto(`/ru/account/verify#token=${token}&next=${encodeURIComponent('//evil.example/x')}`);
  await page.getByRole('button', { name: 'Подтвердить email' }).click();
  await expect(page.getByTestId('verify-done')).toBeVisible();
  // даём возможному (ошибочному) переходу сработать, затем проверяем, что остались на своём сайте
  await page.waitForTimeout(1000);
  expect(new URL(page.url()).origin).toBe(origin);
  // сам next остался во фрагменте, но переходом не стал: страница по-прежнему наша
  expect(new URL(page.url()).pathname).toBe('/ru/account/verify');
});
