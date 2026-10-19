import { expect, test, type Page } from '@playwright/test';
import { SEED_COURSES } from '../../src/lib/db/seed/content';
import type { QuizBlock } from '../../src/lib/content/types';

// Основной сценарий слушателя: демо-клиент → «Моё обучение» → «Целина» → урок → тест → «Урок пройден».
// Правильные ответы берём из демо-контента сида — в браузере их до сдачи нет.
// Первый тест проходит урок демо-клиента (меняет данные сида в памяти сервера): запускать на свежем
// сервере, как делает webServer в playwright.config.ts.

const SLUG = 'vozrazheniya-i-cena'; // урок «Целины» с тестом, у демо-клиента ещё не пройден

function quizOf(slug: string): QuizBlock {
  for (const c of SEED_COURSES) {
    for (const m of c.modules) {
      for (const l of m.lessons) {
        if (l.slug !== slug) continue;
        const q = l.content.ru.blocks.find((b): b is QuizBlock => b.type === 'quiz');
        if (q) return q;
      }
    }
  }
  throw new Error(`нет теста в уроке ${slug}`);
}

async function loginAsClient(page: Page) {
  await page.goto('/ru/login');
  await page.getByTestId('demo-login-client').click();
  await expect(page).toHaveURL(/\/ru\/learn/);
}

/** Отметить варианты: answers[i] — индексы вариантов i-го вопроса. */
async function answer(page: Page, quiz: QuizBlock, answers: number[][]) {
  for (const [qi, picks] of answers.entries()) {
    const q = quiz.questions[qi];
    if (!q) continue;
    for (const oi of picks) await page.getByRole('group', { name: new RegExp(escape(q.text)) }).getByLabel(q.options[oi] as string, { exact: true }).check();
  }
}

function escape(s: string): string {
  return s.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('клиент: Моё обучение → Целина → урок с тестом → результат → «Урок пройден»', async ({ page }) => {
  await loginAsClient(page);

  // «Моё обучение»: простая шапка — только h1 и одна строка, без надписи над заголовком
  await expect(page.getByRole('heading', { level: 1, name: 'Моё обучение' })).toBeVisible();
  await expect(page.getByText('Личный кабинет')).toHaveCount(0);

  // карточка «Целина» с прогрессом и «Продолжить», сертификат в списке
  const celina = page.getByTestId('learn-courses').getByRole('article').filter({ hasText: 'Целина' });
  await expect(celina).toBeVisible();
  await expect(celina.getByRole('progressbar')).toBeVisible();
  await expect(page.getByTestId('learn-certificates')).toContainText('Как проходит бизнес-разбор');

  // программа курса: пройденные уроки и кнопка продолжения
  await celina.getByRole('link', { name: 'Целина' }).click();
  await expect(page).toHaveURL(/\/ru\/learn\/celina$/);
  await expect(page.getByTestId('course-pct')).toHaveText('25%');
  await expect(page.getByTestId('continue-course')).toBeVisible();

  // урок с тестом
  await page.getByRole('link', { name: /Возражения и разговор о цене/ }).click();
  await expect(page).toHaveURL(new RegExp(`/ru/learn/celina/${SLUG}$`));
  await expect(page.getByTestId('lesson-title')).toHaveText('Возражения и разговор о цене');

  // без сданного теста «Урок пройден» недоступен
  const complete = page.getByTestId('complete-lesson');
  await expect(complete).toBeDisabled();

  // варианты ответов в разметке не содержат подсказок: правильные ответы приходят только после попытки
  const quiz = quizOf(SLUG);
  const html = await page.content();
  for (const q of quiz.questions) if (q.explain) expect(html).not.toContain(q.explain.slice(0, 30));

  // неверная попытка: только «не сдан» — ни счёта, ни разбора по вопросам, ни пояснений (D-020)
  const submit = page.getByRole('button', { name: 'Проверить ответы' });
  await expect(submit).toBeDisabled();
  const wrong = quiz.questions.map((q) => [q.correct.includes(0) ? 1 : 0]);
  await answer(page, quiz, wrong);
  await submit.click();
  await expect(page.getByText('Тест не сдан')).toBeVisible();
  await expect(page.getByTestId('quiz-result-text')).toHaveText('Перечитайте урок и попробуйте ещё раз — попыток сколько угодно.');
  // счёта нет: ни «N из M», ни процента
  await expect(page.getByTestId('quiz').getByText(/^\d+ из \d+$/)).toHaveCount(0);
  await expect(page.getByTestId('quiz').getByText(/^\d+%$/)).toHaveCount(0);
  await expect(page.getByTestId('quiz').getByText('Неверно', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('quiz').getByText('Верно', { exact: true })).toHaveCount(0);
  for (const q of quiz.questions) if (q.explain) await expect(page.getByText(q.explain.slice(0, 30))).toHaveCount(0);
  await expect(complete).toBeDisabled();

  // пересдача с правильными ответами
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await answer(
    page,
    quiz,
    quiz.questions.map((q) => q.correct),
  );
  await page.getByRole('button', { name: 'Проверить ответы' }).click();
  await expect(page.getByText('Тест сдан').first()).toBeVisible();
  await expect(page.getByText('3 из 3')).toBeVisible();
  // после сдачи — разбор по вопросам
  await expect(page.getByTestId('quiz').getByText('Верно', { exact: true })).toHaveCount(quiz.questions.length);

  // «Урок пройден»
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(page.getByTestId('lesson-completed-note')).toBeVisible();
  await expect(page.getByTestId('next-lesson')).toBeVisible();
  await expect(page.getByTestId('lesson-done-badge')).toBeVisible();

  // прогресс на программе вырос
  await page.getByRole('link', { name: 'Целина' }).first().click();
  await expect(page.getByTestId('course-pct')).toHaveText('31%');
});

test('закрытый урок последовательного курса и чужой курс не открываются', async ({ page }) => {
  await page.goto('/ru/login');
  await page.getByTestId('demo-login-operator').click();
  await expect(page).toHaveURL(/\/ru\/learn/);
  // внутренний курс последовательный: прямой переход на последний урок ведёт на «закрыт»
  await page.goto('/ru/learn/operator-onboarding/itogovyy-test');
  await expect(page.getByRole('heading', { name: 'Этот урок пока закрыт' })).toBeVisible();

  // курс, на который нет зачисления, — «нет доступа» со ссылкой на страницу курса
  await page.goto('/ru/learn/celina');
  await expect(page.getByTestId('no-access-course-link')).toBeVisible();
  // черновика и несуществующего курса нет
  const res = await page.goto('/ru/learn/net-takogo-kursa');
  expect(res?.status()).toBe(404);
});

test('публичная проверка сертификата без входа: подлинный и неверный номер', async ({ page, browser }) => {
  await loginAsClient(page);
  const link = page.getByTestId('learn-certificates').getByRole('link', { name: 'Страница проверки' });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/\/ru\/cert\/CRP-\d{4}-[A-Z2-9]{6}$/);

  const guest = await browser.newContext();
  const gp = await guest.newPage();
  await gp.goto(`${new URL(page.url()).origin}${href}`);
  await expect(gp.getByTestId('cert-valid')).toBeVisible();
  await expect(gp.getByTestId('cert-holder')).toHaveText('Марат Нурланов');
  await expect(gp.getByTestId('cert-valid')).not.toContainText('@');
  await gp.goto(`${new URL(page.url()).origin}/ru/cert/CRP-2026-ZZZZZZ`);
  await expect(gp.getByTestId('cert-invalid')).toBeVisible();
  await guest.close();
});
