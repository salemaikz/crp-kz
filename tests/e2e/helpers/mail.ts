// Помощник e2e: достать ссылку из последнего письма получателю. В демо письма не уходят наружу,
// администратор видит их на странице «Письма», а ссылку — в блоке демо-ссылки (только в демо).
import { expect, type Browser } from '@playwright/test';
import admin from '../../../messages/ru/admin.json';

export type MailTemplateName = keyof typeof admin.mail.template;

/**
 * Открывает отдельный контекст браузера (сессия покупателя не затрагивается), входит демо-админом,
 * находит самое новое письмо с этим получателем и шаблоном и возвращает путь ссылки вместе с
 * фрагментом: «/ru/password/reset#token=…». Хост отбрасывается: в демо адрес сайта может не
 * совпадать с портом тестового сервера, поэтому открывать нужно относительно baseURL.
 */
export async function openLatestMailLink(
  browser: Browser,
  opts: { to: string; template: MailTemplateName },
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('/ru/login');
    await page.getByTestId('demo-login-admin').click();
    await expect(page).toHaveURL(/\/ru\/admin/);

    await page.goto('/ru/admin/mail');
    // новые письма сверху: первая подходящая строка — последнее письмо
    const row = page
      .getByRole('row')
      .filter({ hasText: opts.to.toLowerCase() })
      .filter({ hasText: admin.mail.template[opts.template] })
      .first();
    await row.getByTestId('mail-open').click();

    const href = await page.getByTestId('mail-demo-link').getAttribute('href');
    if (!href) throw new Error('В письме нет демо-ссылки');
    const url = new URL(href);
    return `${url.pathname}${url.search}${url.hash}`;
  } finally {
    await context.close();
  }
}
