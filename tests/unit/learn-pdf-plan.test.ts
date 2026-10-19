// План PDF сертификата: единое правило «PDF недоступен» и подгонка по высоте.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanCertificateTexts } from '../../src/lib/learn/pdf/glyphs';
import { countLines, fitBlock, sanitizePdfTextDetailed } from '../../src/lib/learn/pdf/layout';
import { geologicaMeasure } from '../../src/lib/learn/pdf/measure';
import {
  COURSE_HARD_MIN_SIZE,
  COURSE_MAX_LINES,
  COURSE_MAX_WIDTH,
  NAME_HARD_MIN_SIZE,
  NAME_MAX_LINES,
  NAME_MAX_WIDTH,
  NAME_TRACKING,
  planCertificatePdf,
} from '../../src/lib/learn/pdf/plan';

const tracked = geologicaMeasure(NAME_TRACKING);
const plain = geologicaMeasure();

describe('sanitizePdfTextDetailed: droppedLetters', () => {
  const has = (c: number) => c < 0x250 || (c >= 0x400 && c <= 0x52f);
  it('иероглифы без глифа — выброшены буквы; эмодзи и галочки — нет', () => {
    assert.deepEqual(sanitizePdfTextDetailed('Анна 中文', has), { text: 'Анна', droppedLetters: true });
    assert.equal(sanitizePdfTextDetailed('Анна \u{1F600}', has).droppedLetters, false);
    assert.equal(sanitizePdfTextDetailed('Ахмет ✓', has).droppedLetters, false);
    assert.equal(sanitizePdfTextDetailed('Анна Серикова', has).droppedLetters, false);
  });
  it('без проверки глифов ничего не считается выброшенным', () => {
    assert.equal(sanitizePdfTextDetailed('Анна 中文').droppedLetters, false);
  });
});

describe('cleanCertificateTexts', () => {
  it('признак droppedLetters поднимается и по имени, и по курсу', () => {
    assert.equal(cleanCertificateTexts({ holderName: 'Анна', courseTitle: 'Курс' }).droppedLetters, false);
    assert.equal(cleanCertificateTexts({ holderName: 'Анна 中', courseTitle: 'Курс' }).droppedLetters, true);
    assert.equal(cleanCertificateTexts({ holderName: 'Анна', courseTitle: 'Курс 中' }).droppedLetters, true);
  });
});

describe('countLines и fitBlock', () => {
  it('считает строки жадным переносом по пробелам', () => {
    assert.equal(countLines('', 20, 500, plain), 0);
    assert.equal(countLines('Курс', 20, 500, plain), 1);
    const words = Array.from({ length: 30 }, () => 'Предприниматель').join(' ');
    const n = countLines(words, 20, 500, plain);
    assert.ok(n > 3, `строк ${n}`);
  });
  it('короткий текст не уменьшается', () => {
    const r = fitBlock('Анна Серикова', 47, 26, 14, NAME_MAX_WIDTH, NAME_MAX_LINES, tracked);
    assert.deepEqual({ size: r.size, lines: r.lines, fits: r.fits }, { size: 47, lines: 1, fits: true });
  });
  it('длинный ввод: кегль опускается ниже минимума, но не ниже жёсткого предела', () => {
    const name = 'Жумабаева Ж '.repeat(16).trim();
    const r = fitBlock(name, 26, 26, NAME_HARD_MIN_SIZE, NAME_MAX_WIDTH, NAME_MAX_LINES, tracked);
    assert.ok(r.size < 26 && r.size >= NAME_HARD_MIN_SIZE, `size ${r.size}`);
    assert.ok(r.fits && r.lines <= NAME_MAX_LINES);
  });
  it('не влезает и на жёстком пределе — fits=false', () => {
    const r = fitBlock('Ж'.repeat(200), 26, 26, NAME_HARD_MIN_SIZE, NAME_MAX_WIDTH, NAME_MAX_LINES, tracked);
    assert.equal(r.fits, false);
    assert.equal(r.size, NAME_HARD_MIN_SIZE);
  });
});

describe('planCertificatePdf: когда PDF недоступен', () => {
  it('обычные имя и курс — доступен', () => {
    const p = planCertificatePdf({ holderName: 'Марат Нурланов', courseTitle: 'Бизнес-разбор' });
    assert.equal(p.ok, true);
    assert.equal(p.name.size, 47);
  });
  it('пустое имя после очистки', () => {
    assert.equal(planCertificatePdf({ holderName: '\u{1F600}\u{1F680}', courseTitle: 'Бизнес-разбор' }).ok, false);
  });
  it('пустой курс при обычном имени', () => {
    assert.equal(planCertificatePdf({ holderName: 'Марат Нурланов', courseTitle: '\u{1F600}' }).ok, false);
    assert.equal(planCertificatePdf({ holderName: 'Марат Нурланов', courseTitle: '   ' }).ok, false);
  });
  it('часть букв имени не отображается — имя вышло бы обрезанным', () => {
    assert.equal(planCertificatePdf({ holderName: 'Анна 中文', courseTitle: 'Бизнес-разбор' }).ok, false);
    assert.equal(planCertificatePdf({ holderName: 'Анна', courseTitle: 'Курс 中文' }).ok, false);
  });
  it('эмодзи рядом с обычным именем — не буквы, PDF доступен', () => {
    assert.equal(planCertificatePdf({ holderName: 'Анна \u{1F600}', courseTitle: 'Курс' }).ok, true);
  });
  it('патологически длинные ФИО и курс: влезают по строкам либо PDF недоступен, но не вылезают', () => {
    for (const holderName of ['Ж'.repeat(200), 'Жумабаева Ж '.repeat(16).trim(), 'Ш '.repeat(100).trim()]) {
      const p = planCertificatePdf({ holderName, courseTitle: 'Курс' });
      if (!p.ok) continue;
      assert.ok(p.name.size >= NAME_HARD_MIN_SIZE);
      assert.ok(countLines(p.name.text, p.name.size, NAME_MAX_WIDTH, tracked) <= NAME_MAX_LINES);
    }
    for (const courseTitle of ['Ж'.repeat(200), 'Предпринимательство и управление '.repeat(6).trim(), 'Ш '.repeat(100).trim()]) {
      const p = planCertificatePdf({ holderName: 'Анна', courseTitle });
      if (!p.ok) continue;
      assert.ok(p.course.size >= COURSE_HARD_MIN_SIZE);
      assert.ok(countLines(p.course.text, p.course.size, COURSE_MAX_WIDTH, plain) <= COURSE_MAX_LINES);
    }
  });
  it('200 заглавных Ж в ФИО не влезают даже на жёстком пределе — PDF недоступен', () => {
    assert.equal(planCertificatePdf({ holderName: 'Ж'.repeat(200), courseTitle: 'Курс' }).ok, false);
  });
  it('200 широких букв в имени и курсе: кегль ниже минимума либо недоступно', () => {
    const p = planCertificatePdf({ holderName: 'Жумабаева Ж '.repeat(16).trim(), courseTitle: 'Предпринимательство и управление '.repeat(6).trim() });
    assert.equal(p.ok, true);
    assert.ok(p.name.size < 26 && p.course.size < 18, `${p.name.size} / ${p.course.size}`);
  });
});
