import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { SEED_COURSES } from '../../src/lib/db/seed/content';

// Загрузка файлов (4B): админ добавляет в урок «Целины» картинку, документ и ссылку в тексте;
// слушатель в демо видит картинку, а документ — только подписью (D-038); гость и чужой пользователь
// файлов не получают; обложка курса видна гостю в каталоге. Сценарии зависят друг от друга
// (id файлов из первого нужны остальным), поэтому идут по порядку. Файлы собираются буферами.

test.describe.configure({ mode: 'serial' });

const COURSE = SEED_COURSES.find((c) => c.slug === 'celina');
const LESSON = COURSE?.modules[0]?.lessons[0];
if (!COURSE || !LESSON) throw new Error('в сиде нет первого урока «Целины»');
const LESSON_URL = `/ru/learn/${COURSE.slug}/${LESSON.slug}`;
const LESSON_TITLE = LESSON.title.ru;
const DEMO_LABEL = 'В демо загруженные документы видит только администратор.';

// ---------- синтетические файлы ----------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

/** PNG в оттенках серого, все пиксели нулевые. */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 0, 0, 0, 0])]);
  const raw = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdf(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

// ---------- помощники ----------

async function login(page: Page, role: 'admin' | 'client' | 'operator') {
  await page.goto('/ru/login');
  await page.getByTestId(`demo-login-${role}`).click();
  await expect(page).toHaveURL(role === 'admin' ? /\/ru\/admin/ : /\/ru\/learn/);
}

/** Отдельный контекст браузера под ролью: сессии сценариев не смешиваются. */
async function asRole(browser: Browser, role: 'client' | 'operator') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, role);
  return { context, page };
}

/** Админ открывает редактор первого урока «Целины»; возвращает id курса и урока из адреса. */
async function openEditor(page: Page): Promise<{ courseId: string; lessonId: string }> {
  await page.goto('/ru/admin/courses');
  await page.getByRole('link', { name: COURSE?.title.ru ?? '', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]{36}$/);
  const courseId = /courses\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await page.getByTestId('lesson-row').filter({ hasText: LESSON_TITLE }).first().getByRole('link', { name: LESSON_TITLE }).first().click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/);
  const lessonId = /lessons\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  return { courseId, lessonId };
}

type Uploaded = { id: string; name: string };

/** Выбрать файл в скрытом input и дождаться ответа /api/uploads. */
async function pickFile(
  page: Page,
  testId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  scope: Page | Locator = page,
): Promise<Uploaded | null> {
  const response = page.waitForResponse((r) => r.url().includes('/api/uploads') && r.request().method() === 'POST');
  await scope.getByTestId(`${testId}-input`).first().setInputFiles(file);
  const body = (await (await response).json()) as { ok: boolean; file?: Uploaded };
  return body.ok && body.file ? body.file : null;
}

let ids = { courseId: '', lessonId: '', png: '', pdf: '' };

test('админ: картинка, документ и ссылка в тексте добавляются в урок и видны в предпросмотре', async ({ page }) => {
  await login(page, 'admin');
  const { courseId, lessonId } = await openEditor(page);
  ids = { ...ids, courseId, lessonId };

  // в демо над кнопками загрузки — предупреждение о персональных данных
  await expect(page.getByTestId('upload-demo-warning').first()).toContainText('Не загружайте документы с персональными данными');

  // «Изображение»: блок появляется после загрузки, текст вместо изображения обязателен
  const image = await pickFile(page, 'add-block-image', { name: 'схема.png', mimeType: 'image/png', buffer: png(64, 48) });
  expect(image).not.toBeNull();
  ids.png = image?.id ?? '';
  const imageBlock = page.locator('[data-block-type="image"]').last();
  await expect(imageBlock).toBeVisible();
  await imageBlock.getByTestId('image-alt').fill('Схема этапов');
  await imageBlock.getByLabel('Подпись').fill('Рисунок 1');

  // «Файл»: карточка показывает тип и размер
  const doc = await pickFile(page, 'add-block-file', { name: 'памятка.pdf', mimeType: 'application/pdf', buffer: pdf() });
  expect(doc).not.toBeNull();
  ids.pdf = doc?.id ?? '';
  const fileBlock = page.locator('[data-block-type="file"]').last();
  await expect(fileBlock.getByTestId('file-card')).toContainText(/PDF · /);
  await fileBlock.getByLabel('Название для слушателя').fill('Памятка менеджера');

  // текстовый блок: ссылка на документ и «Вставить картинку» в позицию курсора
  await page.getByTestId('add-block-text').first().click();
  const textBlock = page.locator('[data-block-type="text"]').last();
  const area = textBlock.getByLabel('Текст (Markdown)');
  await area.fill(`Скачайте [памятку](/api/files/${ids.pdf}) до начала.`);
  const inserted = await pickFile(page, 'insert-image', { name: 'вставка.png', mimeType: 'image/png', buffer: png(32, 32) }, textBlock);
  expect(inserted).not.toBeNull();
  await expect(area).toHaveValue(new RegExp(`!\\[\\]\\(/api/files/${inserted?.id}\\)`));
  await expect(area).toHaveValue(/Скачайте \[памятку\]/);

  await page.getByTestId('lesson-save').click();
  await expect(page.getByTestId('lesson-saved')).toBeVisible();

  // предпросмотр: картинка загружена, карточка файла с «PDF · …»
  await page.getByTestId('mode-preview').click();
  const preview = page.locator('.adm-preview-card');
  const img = preview.getByTestId('preview-image');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(preview.getByTestId('preview-file')).toContainText(/PDF · /);
  await expect(preview.getByTestId('preview-file')).toContainText('Памятка менеджера');

  // админ получает документ: вложением, с защитными заголовками
  const res = await page.request.get(`/api/files/${ids.pdf}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['content-disposition']).toMatch(/^attachment/);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('слушатель в демо: картинка видна, документ и ссылка на него — подписью без ссылки (D-038)', async ({ browser }) => {
  const { context, page } = await asRole(browser, 'client');
  try {
    await page.goto(LESSON_URL);
    await expect(page.getByTestId('lesson-title')).toBeVisible();

    // блок «Изображение»: файл отдаётся как image/png с nosniff
    const figure = page.getByTestId('image-block');
    await expect(figure).toBeVisible();
    const img = figure.locator('img');
    await expect(img).toHaveAttribute('alt', 'Схема этапов');
    await expect(figure).toContainText('Рисунок 1');
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const imgRes = await page.request.get(`/api/files/${ids.png}`);
    expect(imgRes.status()).toBe(200);
    expect(imgRes.headers()['content-type']).toBe('image/png');
    expect(imgRes.headers()['x-content-type-options']).toBe('nosniff');

    // блок «Файл»: подпись вместо «Скачать»
    const card = page.getByTestId('file-block').filter({ hasText: 'Памятка менеджера' });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('file-demo-hidden')).toHaveText(DEMO_LABEL);
    await expect(card.getByRole('link')).toHaveCount(0);

    // ссылка на документ в тексте: подпись без href
    const hiddenLink = page.getByTestId('file-link-hidden');
    await expect(hiddenLink).toContainText('памятку');
    await expect(hiddenLink).toContainText(DEMO_LABEL);
    await expect(page.locator(`a[href*="/api/files/${ids.pdf}"]`)).toHaveCount(0);

    // картинка из текста урока показывается как обычно
    await expect(page.locator('.lrn-prose img')).toHaveCount(1);

    // сам документ слушателю не выдаётся
    expect((await page.request.get(`/api/files/${ids.pdf}`)).status()).toBe(404);
  } finally {
    await context.close();
  }
});

test('гость: файл урока ведёт на вход; пользователь без зачисления получает 404', async ({ playwright, browser }) => {
  const guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    for (const id of [ids.png, ids.pdf]) {
      const res = await guest.get(`/api/files/${id}`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers().location).toMatch(/\/ru\/login/);
    }
  } finally {
    await guest.dispose();
  }

  const { context, page } = await asRole(browser, 'operator');
  try {
    // оператор не зачислен на «Целину»: файлы урока для него не существуют
    expect((await page.request.get(`/api/files/${ids.png}`)).status()).toBe(404);
    expect((await page.request.get(`/api/files/${ids.pdf}`)).status()).toBe(404);
  } finally {
    await context.close();
  }
});

test('админ: файл неверного типа отклоняется понятным текстом, блок не создаётся', async ({ page }) => {
  await login(page, 'admin');
  await openEditor(page);
  const before = await page.locator('.adm-block').count();

  const response = page.waitForResponse((r) => r.url().includes('/api/uploads') && r.request().method() === 'POST');
  await page.getByTestId('add-block-image-input').first().setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html><body>не картинка</body></html>', 'utf8'),
  });
  expect((await response).status()).toBe(415);
  await expect(page.getByTestId('upload-error').first()).toContainText('Этот тип файла не поддерживается');
  await expect(page.locator('.adm-block')).toHaveCount(before);

  // загрузка из APIRequestContext: сервер отклоняет запрос без Origin своего хоста
  const url = `/api/uploads?purpose=lesson_material&courseId=${ids.courseId}&lessonId=${ids.lessonId}`;
  const headers = { 'Content-Type': 'application/octet-stream', 'X-Upload-Name': encodeURIComponent('лишний.png') };
  const noOrigin = await page.request.post(url, { data: png(16, 16), headers });
  expect(noOrigin.status()).toBe(403);
  expect(((await noOrigin.json()) as { error: string }).error).toBe('cross_site');
  const withOrigin = await page.request.post(url, { data: png(16, 16), headers: { ...headers, Origin: new URL(page.url()).origin } });
  expect(withOrigin.status()).toBe(201);
});

test('админ: страница «Файлы курса» — занято места, где используется, удаление только неиспользуемых', async ({ page }) => {
  await login(page, 'admin');
  await page.goto(`/ru/admin/courses/${ids.courseId}`);
  await page.getByTestId('course-files-link').click();
  await expect(page).toHaveURL(new RegExp(`/admin/courses/${ids.courseId}/files$`));
  await expect(page.getByTestId('files-usage')).toContainText(/Занято .+ из .+/);

  // используемый документ ссылается на урок и не удаляется
  const used = page.getByRole('row').filter({ hasText: 'памятка.pdf' });
  await expect(used).toContainText(LESSON_TITLE);
  await expect(used.getByTestId('file-delete')).toHaveCount(0);

  // файл из прошлого сценария нигде не используется: удаляется с подтверждением
  const unused = page.getByRole('row').filter({ hasText: 'лишний.png' });
  await expect(unused).toContainText('Не используется');
  page.once('dialog', (d) => void d.accept());
  await unused.getByTestId('file-delete').click();
  await expect(page.getByRole('row').filter({ hasText: 'лишний.png' })).toHaveCount(0);
  await expect(used).toBeVisible();
});

test('админ: обложка курса видна гостю в каталоге', async ({ page, browser }) => {
  await login(page, 'admin');
  await page.goto(`/ru/admin/courses/${ids.courseId}?tab=settings`);
  const card = page.getByTestId('cover-card');
  await expect(card.getByTestId('cover-empty')).toBeVisible();
  await expect(card.getByTestId('upload-demo-warning')).toBeVisible();

  // обложка меньше 800x450 отклоняется
  const small = page.waitForResponse((r) => r.url().includes('/api/uploads') && r.request().method() === 'POST');
  await card.getByTestId('cover-upload-input').setInputFiles({ name: 'малая.png', mimeType: 'image/png', buffer: png(400, 200) });
  expect((await small).status()).toBe(422);
  await expect(card.getByTestId('upload-error')).toContainText('не меньше 800×450');

  const cover = await pickFile(page, 'cover-upload', { name: 'обложка.png', mimeType: 'image/png', buffer: png(1200, 675) });
  expect(cover).not.toBeNull();
  await expect(card.getByTestId('cover-saved')).toBeVisible();
  await expect(card.getByTestId('cover-preview')).toHaveAttribute('src', `/api/files/${cover?.id}`);

  // гость: карточка «Целины» с картинкой из /api/files
  const guest = await browser.newContext();
  try {
    const gp = await guest.newPage();
    await gp.goto('/ru/courses');
    const img = gp.locator(`img[src="/api/files/${cover?.id}"]`).first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  } finally {
    await guest.close();
  }

  // «Убрать обложку» возвращает цветную панель
  await card.getByTestId('cover-remove').click();
  await expect(card.getByTestId('cover-empty')).toBeVisible();
  await expect(card.getByTestId('cover-saved')).toHaveCount(0);
});

test('админ: две загрузки подряд дают оба блока', async ({ page }) => {
  await login(page, 'admin');
  await openEditor(page);
  const before = await page.locator('.adm-block').count();

  // обе загрузки стартуют до завершения первой; блоки добавляются к актуальному списку
  let done = 0;
  const bothDone = new Promise<void>((resolve) => {
    page.on('response', (r) => {
      if (r.url().includes('/api/uploads') && r.request().method() === 'POST' && ++done === 2) resolve();
    });
  });
  await page.getByTestId('add-block-image-input').first().setInputFiles({ name: 'один.png', mimeType: 'image/png', buffer: png(64, 48) });
  await page.getByTestId('add-block-file-input').first().setInputFiles({ name: 'два.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await bothDone;
  await expect(page.locator('.adm-block')).toHaveCount(before + 2);
  await expect(page.locator('[data-block-type="image"]')).not.toHaveCount(0);
  await expect(page.locator('[data-block-type="file"]')).not.toHaveCount(0);
});

test('админ с доступом к курсу: документ в уроке со ссылкой «Скачать», без демо-подписи', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/ru/admin/users');
  await page.getByTestId('user-search').fill('admin@');
  await page.getByRole('button', { name: 'Найти' }).click();
  await page.getByRole('link', { name: /admin@/ }).first().click();
  const grant = page.getByTestId('grant-form');
  await grant.getByLabel('Курс').selectOption({ label: COURSE?.title.ru ?? '' });
  await page.getByTestId('grant-submit').click();
  await expect(grant.getByText('Доступ выдан')).toBeVisible();

  await page.goto(LESSON_URL);
  const card = page.getByTestId('file-block').filter({ hasText: 'Памятка менеджера' });
  await expect(card.getByTestId('file-download')).toHaveAttribute('href', `/api/files/${ids.pdf}`);
  await expect(page.getByTestId('file-demo-hidden')).toHaveCount(0);
  await expect(page.locator(`.lrn-prose a[href="/api/files/${ids.pdf}"]`)).toHaveCount(1);
});
