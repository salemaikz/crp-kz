import { expect, test, type Browser, type Page } from '@playwright/test';
import { openLatestMailLink } from './helpers/mail';

// Покупка, Фаза 0 (D-007, D-020): гость → вход/регистрация → оформление заказа на свой аккаунт →
// админ (демо) подтверждает оплату → заказ оплачен, доступ открыт. Покупатель — новый аккаунт:
// сценарий не зависит от состояния демо-клиента и повторяется (retries в CI).
// С EMAIL_VERIFY (D-032, предложено) форма покупки закрыта, пока новый аккаунт не подтвердит email;
// с LEGAL (D-035, предложено) на покупке две галочки. В демо оба флага включены.

/** Новый аккаунт открывает форму покупки, подтверждает email по письму из «Писем» и возвращается к форме. */
async function confirmEmail(page: Page, browser: Browser, email: string): Promise<void> {
  const panel = page.getByTestId('verify-notice-checkout');
  await expect(panel).toContainText('Заказ можно оформить после подтверждения email');
  await expect(page.getByTestId('verify-demo-hint')).toBeVisible();
  // форма закрыта, а плашка из layout не дублирует кнопку: на странице одна кнопка отправки письма
  await expect(page.getByLabel('Телефон')).toHaveCount(0);
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отправить письмо' })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Отправить письмо' })).toBeVisible();

  // повторное письмо с панели покупки: прежняя ссылка гасится, новая обязана вести обратно на форму
  await panel.getByRole('button', { name: 'Отправить письмо' }).click();
  await expect(page.getByTestId('verify-resent')).toBeVisible();

  const link = await openLatestMailLink(browser, { to: email, template: 'email_verify' });
  expect(link).toMatch(/^\/ru\/account\/verify#token=[\w-]{43}&next=%2Fru%2Fcourses%2Fsales-doubling%2Fbuy$/);
  await page.goto(link);
  // на странице подтверждения плашки из layout нет
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить email' }).click();
  await expect(page).toHaveURL(/\/ru\/courses\/sales-doubling\/buy$/);
  await expect(page.getByTestId('verify-notice-checkout')).toHaveCount(0);
  await expect(page.getByLabel('Телефон')).toBeVisible();
}

test('гость: «Войти и купить» → регистрация → подтверждение email → заказ «Удвоение личных продаж» через Kaspi → админ подтверждает', async ({
  page,
  browser,
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
  // подпись галочки — со ссылками на документы, они открываются в новой вкладке
  const registerConsent = page.getByLabel(/Даю согласие на сбор и обработку/);
  await expect(page.locator('label.check a[target="_blank"]')).toHaveCount(2);
  await registerConsent.check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page).toHaveURL(/\/ru\/courses\/sales-doubling\/buy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Удвоение личных продаж' })).toBeVisible();
  await confirmEmail(page, browser, email);
  await expect(page.getByText('49 000 ₸').first()).toBeVisible();
  // имя — из аккаунта, email — email аккаунта, его не меняют
  await expect(page.getByLabel('Имя и фамилия')).toHaveValue('Тест Покупатель');
  const emailField = page.getByLabel('Email');
  await expect(emailField).toHaveValue(email);
  await expect(emailField).toHaveAttribute('readonly', '');

  await page.getByLabel('Телефон').fill('8 701 100 09 29');
  await expect(page.getByRole('radio', { name: /^Kaspi/ })).toBeChecked();

  // без согласий заказ не создаётся, введённое сохраняется; у каждой галочки своя ошибка
  const offerError = 'Без согласия с офертой заказ не оформить.';
  const pdError = 'Без согласия на обработку персональных данных заказ не оформить.';
  await page.getByRole('button', { name: /Оформить заказ/ }).click();
  await expect(page.getByText(offerError)).toBeVisible();
  await expect(page.getByText(pdError)).toBeVisible();
  await expect(page.getByLabel('Телефон')).toHaveValue('8 701 100 09 29');
  await expect(page.getByLabel('Email')).toHaveValue(email);

  // только оферта: ошибка остаётся у согласия на ПДн
  await page.getByLabel(/Принимаю условия публичной оферты/).check();
  await page.getByRole('button', { name: /Оформить заказ/ }).click();
  await expect(page.getByText(offerError)).toHaveCount(0);
  await expect(page.getByText(pdError)).toBeVisible();
  await expect(page.getByLabel(/Принимаю условия публичной оферты/)).toBeChecked();

  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
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

test('открытый заказ с другим способом оплаты: пометка на странице заказа, владелец отменяет его и оформляет новый', async ({
  page,
  browser,
}) => {
  const email = `e2e-own-${Date.now()}@example.kz`;
  await page.goto('/ru/register?next=%2Fru%2Fcourses%2Fsales-doubling%2Fbuy');
  await page.getByLabel('Имя и фамилия').fill('Тест Владелец');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill('e2e-password-123');
  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/ru\/courses\/sales-doubling\/buy$/);
  await confirmEmail(page, browser, email);

  const order = async (method: 'Kaspi' | 'Счёт на оплату') => {
    await page.getByLabel('Телефон').fill('8 701 100 09 29');
    await page.getByRole('radio', { name: new RegExp(`^${method}`) }).check();
    await page.getByLabel(/Принимаю условия публичной оферты/).check();
    await page.getByLabel(/Даю согласие на сбор и обработку/).check();
    await page.getByRole('button', { name: /Оформить заказ/ }).click();
    await expect(page).toHaveURL(/\/ru\/orders\/CRP-\d{6}-\d{4}\?/);
    return /\/orders\/(CRP-\d{6}-\d{4})/.exec(page.url())?.[1] ?? '';
  };

  const first = await order('Kaspi');
  await expect(page.getByTestId('order-notice')).toHaveCount(0);

  // тот же курс, но счёт вместо Kaspi: открывается прежний заказ с пометкой
  await page.goto('/ru/courses/sales-doubling/buy');
  const again = await order('Счёт на оплату');
  expect(again).toBe(first);
  await expect(page).toHaveURL(/notice=existing_differs/);
  await expect(page.getByTestId('order-notice')).toContainText('оформлен иначе');
  await expect(page.getByRole('heading', { level: 1, name: 'Оплатите заказ через Kaspi' })).toBeVisible();

  // владелец отменяет свой заказ (два шага)
  await page.getByTestId('owner-cancel-order').click();
  await page.getByTestId('owner-cancel-confirm').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Заказ отменён' })).toBeVisible();
  await expect(page.getByTestId('order-notice')).toContainText('Заказ отменён. Можно оформить новый.');
  await expect(page.getByTestId('owner-cancel-order')).toHaveCount(0);

  // и оформляет новый — со счётом
  await page.getByRole('link', { name: 'Оформить заново' }).click();
  await expect(page).toHaveURL(/\/ru\/courses\/sales-doubling\/buy$/);
  const fresh = await order('Счёт на оплату');
  expect(fresh).not.toBe(first);
  await expect(page.getByRole('heading', { level: 1, name: 'Счёт на оплату готов' })).toBeVisible();
  await expect(page.getByTestId('order-notice')).toHaveCount(0);
});

test('плашка подтверждения из layout: кнопка передаёт страницу, где нажата; на покупке плашки нет', async ({ page, browser }) => {
  const email = `e2e-notice-${Date.now()}@example.kz`;
  await page.goto('/ru/register');
  await page.getByLabel('Имя и фамилия').fill('Тест Плашка');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill('e2e-password-123');
  await page.getByLabel(/Даю согласие на сбор и обработку/).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/ru\/learn$/);

  const banner = page.getByTestId('verify-notice');
  await expect(banner).toBeVisible();
  // кнопка плашки отправляет путь текущей страницы (скрытое поле next из usePathname, без query)
  const sent = page.waitForRequest((r) => r.method() === 'POST' && (r.postData() ?? '').includes('/ru/learn'));
  await banner.getByRole('button', { name: 'Отправить письмо' }).click();
  await sent;
  await expect(page.getByTestId('verify-resent')).toBeVisible();

  const link = await openLatestMailLink(browser, { to: email, template: 'email_verify' });
  expect(link).toMatch(/^\/ru\/account\/verify#token=[\w-]{43}/);

  // на странице курса плашка есть, на покупке её нет: там своя панель
  await page.goto('/ru/courses/sales-doubling');
  await expect(page.getByTestId('verify-notice')).toBeVisible();
  await page.goto('/ru/courses/sales-doubling/buy');
  await expect(page.getByTestId('verify-notice')).toHaveCount(0);
  await expect(page.getByTestId('verify-notice-checkout')).toBeVisible();
});
