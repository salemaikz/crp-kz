// Вёрстка PDF сертификата: размеры шрифтов, очистка строк, QR вектором, ETag.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { certificatePdfEtag } from '../../src/lib/learn/pdf/etag';
import { hasPdfGlyph } from '../../src/lib/learn/pdf/glyphs';
import { courseFontSize, fitFontSize, fitText, nameFontSize, sanitizePdfText } from '../../src/lib/learn/pdf/layout';
import { geologicaMeasure } from '../../src/lib/learn/pdf/measure';
import { qrPath } from '../../src/lib/learn/pdf/qr';
import { CERT_PDF_TEMPLATE_VERSION, type CertificatePdfInput } from '../../src/lib/learn/pdf/types';

const rep = (n: number) => 'а'.repeat(n);

describe('nameFontSize', () => {
  it('пороги: 28, 40 и 60 знаков', () => {
    assert.equal(nameFontSize(rep(1)), 47);
    assert.equal(nameFontSize(rep(28)), 47);
    assert.equal(nameFontSize(rep(29)), 38);
    assert.equal(nameFontSize(rep(40)), 38);
    assert.equal(nameFontSize(rep(41)), 32);
    assert.equal(nameFontSize(rep(60)), 32);
    assert.equal(nameFontSize(rep(61)), 26);
  });
  it('считает символы, а не кодовые единицы UTF-16', () => {
    assert.equal(nameFontSize('😀'.repeat(28)), 47);
  });
});

describe('courseFontSize', () => {
  it('пороги: 60 и 100 знаков', () => {
    assert.equal(courseFontSize(rep(60)), 25);
    assert.equal(courseFontSize(rep(61)), 21);
    assert.equal(courseFontSize(rep(100)), 21);
    assert.equal(courseFontSize(rep(101)), 18);
  });
});

describe('sanitizePdfText', () => {
  it('убирает bidi-переопределения, управляющие и невидимые символы', () => {
    // U+202E, U+2066, U+2069 — bidi; U+0000, U+0007, U+0085 — управляющие; U+200B, U+FEFF — невидимые
    const c = (...n: number[]) => String.fromCharCode(...n);
    const evil = `A${c(0x202e)}лиса${c(0x2066)}x${c(0x2069, 0, 7, 0x85)}B${c(0x200b)}в${c(0xfeff)}`;
    assert.equal(sanitizePdfText(evil), 'Aлисаx Bв');
  });
  it('разделители строки и абзаца (U+2028, U+2029) становятся пробелом', () => {
    const sep = String.fromCharCode(0x2028, 0x2029);
    assert.equal(sanitizePdfText(`Анна${sep}Серикова`), 'Анна Серикова');
  });
  it('переводы строк и табы становятся пробелом, пробелы схлопываются', () => {
    assert.equal(sanitizePdfText('  Анна\n\tКамила   Серикова \r\n'), 'Анна Камила Серикова');
  });
  it('обрезает до 200 символов', () => {
    assert.equal(Array.from(sanitizePdfText(rep(500))).length, 200);
  });
  it('казахские буквы не затрагиваются', () => {
    assert.equal(sanitizePdfText('Әлия Құрманғалиқызы'), 'Әлия Құрманғалиқызы');
  });
});

describe('sanitizePdfText: символы вне шрифта', () => {
  const has = (c: number) => c < 0x250 || (c >= 0x400 && c <= 0x52f);
  it('удаляет эмодзи, галочки и иероглифы, пробелы схлопывает', () => {
    assert.equal(sanitizePdfText('Анна \u{1F600}', has), 'Анна');
    assert.equal(sanitizePdfText('Ахмет \u2713 Бек', has), 'Ахмет Бек');
    assert.equal(sanitizePdfText('Анна \u4e2d\u6587', has), 'Анна');
    assert.equal(sanitizePdfText('Маркетинг 2.0 \u2714', has), 'Маркетинг 2.0');
  });
  it('расширенная латиница и казахские буквы остаются, неразрывный пробел остаётся пробелом', () => {
    assert.equal(sanitizePdfText('Gülşen Ağabek\u00a0Nūrlan', has), 'Gülşen Ağabek Nūrlan');
  });
});

describe('sanitizePdfText: NFD', () => {
  const has = (cp: number) => hasPdfGlyph(cp);
  it('«й», «ё», «Ә» в разложенной форме собираются обратно, диакритика не теряется', () => {
    assert.equal(sanitizePdfText('й', has), 'й');
    assert.equal(sanitizePdfText('Ёлка', has), 'Ёлка');
    assert.equal(sanitizePdfText('Й'.normalize('NFD'), has), 'Й');
    assert.equal(sanitizePdfText('Ә'.normalize('NFD'), has), 'Ә');
    assert.equal(sanitizePdfText('Артём Йылмаз'.normalize('NFD'), has), 'Артём Йылмаз');
  });
});

describe('fitFontSize и fitText (замер шрифтом)', () => {
  const plain = geologicaMeasure();
  const tracked = geologicaMeasure(-0.03);
  it('короткое имя не трогает', () => {
    assert.equal(fitFontSize(47, 'Анна Серикова', 700, tracked, 26), 47);
  });
  it('широкие заглавные влезают в рамку: оценка 0,72 em их недооценивала', () => {
    const word = 'ЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ';
    const size = fitFontSize(47, word, 700, tracked, 20);
    assert.ok(size < 47, `size ${size}`);
    assert.ok(tracked(word, size) <= 700, `ширина ${tracked(word, size)}`);
    assert.ok(tracked(word, size + 0.5) > 700 || size === 47, 'кегль мог быть крупнее');
  });
  it('составное слово с дефисом — одно неразрывное слово', () => {
    const word = 'ҚҰРМАНҒАЛИҚЫЗЫ-НҰРСҰЛТАНОВА';
    const size = fitFontSize(47, word, 700, tracked, 20);
    assert.ok(tracked(word, size) <= 700);
    // половина слова поместилась бы на большем кегле, но слово целиком не делится
    assert.ok(size < fitFontSize(47, 'ҚҰРМАНҒАЛИҚЫЗЫ-', 700, tracked, 20));
  });
  it('на минимальном кегле слово режется пробелами и влезает', () => {
    const r = fitText('А'.repeat(200), 26, 26, 700, tracked);
    assert.equal(r.size, 26);
    assert.ok(r.text.includes(' '));
    assert.equal(r.text.replace(/ /g, ''), 'А'.repeat(200));
    for (const part of r.text.split(' ')) assert.ok(tracked(part, 26) <= 700);
  });
  it('курс без трекинга: длинное слово уменьшается не ниже минимума', () => {
    const r = fitText('Предпринимательство'.repeat(3), 25, 18, 522, plain);
    assert.equal(r.size, 18);
    for (const part of r.text.split(' ')) assert.ok(plain(part, 18) <= 522);
  });
});

describe('qrPath', () => {
  const url = 'https://crp.example/kz/cert/CRP-2026-ABCDEF';
  it('матрица не меньше 25 модулей, путь непустой и из прямоугольников', () => {
    const { size, d } = qrPath(url);
    assert.ok(size >= 25, `size ${size}`);
    assert.ok(d.length > 0);
    assert.match(d, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });
  it('сумма длин отрезков равна числу тёмных модулей, а отрезков меньше модулей (склейка по строкам)', () => {
    const { d, size } = qrPath(url);
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
    const dark = runs.reduce((n, m) => n + Number(m[3]), 0);
    assert.ok(runs.length < dark, 'подряд идущие модули не склеены');
    for (const m of runs) {
      assert.ok(Number(m[1]) + Number(m[3]) <= size && Number(m[2]) < size, 'отрезок вне матрицы');
    }
    // стабильность: тот же адрес — тот же путь
    assert.equal(qrPath(url).d, d);
  });
  it('другой адрес даёт другой путь', () => {
    assert.notEqual(qrPath(url).d, qrPath(`${url}X`).d);
  });
});

describe('certificatePdfEtag', () => {
  const base: CertificatePdfInput = {
    number: 'CRP-2026-ABCDEF',
    holderName: 'Марат Нурланов',
    courseTitle: 'Целина',
    issuedAt: 1_760_000_000_000,
    locale: 'ru',
    verifyUrl: 'https://crp.example/ru/cert/CRP-2026-ABCDEF',
    issuedDate: '9 октября 2025 г.',
    verifyHost: 'crp.example/ru/cert',
    labels: {
      title: 'Сертификат',
      certifies: 'Настоящим подтверждается, что',
      completed: 'успешно завершил(а) обучение по курсу',
      issued: 'Дата выдачи',
      number: 'Номер',
      org: 'Центр Развития Предпринимателей',
      place: 'Астана',
      qrTitle: 'Проверка подлинности',
      metaTitle: 'Сертификат CRP-2026-ABCDEF',
    },
  };
  it('слабый ETag, стабилен при тех же данных', () => {
    assert.match(certificatePdfEtag(base), /^W\/"[0-9a-f]{32}"$/);
    assert.equal(certificatePdfEtag(base), certificatePdfEtag({ ...base }));
  });
  it('меняется от ФИО, курса, номера, даты, языка, адреса и подписей', () => {
    const e = certificatePdfEtag(base);
    const variants: Partial<CertificatePdfInput>[] = [
      { holderName: 'Другой Человек' },
      { courseTitle: 'Другой курс' },
      { number: 'CRP-2026-ZZZZZZ' },
      { issuedAt: base.issuedAt + 1 },
      { locale: 'kz' },
      { verifyUrl: `${base.verifyUrl}x` },
      { labels: { ...base.labels, title: 'Иное' } },
    ];
    for (const v of variants) assert.notEqual(certificatePdfEtag({ ...base, ...v }), e, JSON.stringify(Object.keys(v)));
  });
  it('версия макета входит в ETag', () => {
    assert.ok(Number.isInteger(CERT_PDF_TEMPLATE_VERSION) && CERT_PDF_TEMPLATE_VERSION >= 1);
    assert.equal(certificatePdfEtag(base), certificatePdfEtag(base, CERT_PDF_TEMPLATE_VERSION));
    assert.notEqual(certificatePdfEtag(base, 1), certificatePdfEtag(base, 2));
  });
});
