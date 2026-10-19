// Срезы шрифтов PDF: все нужные символы на месте, лицензии рядом, хэши совпадают с зафиксированными.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { codePointsOf, readCmapCodePoints } from '../helpers/ttf-cmap';

const DIR = path.join(process.cwd(), 'assets/fonts/pdf');
const FONTS = ['Geologica-Bold-SHRP100.ttf', 'Onest-Regular.ttf', 'Onest-SemiBold.ttf'] as const;

const ALPHABETS = {
  'кириллица (прописные)': 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  'кириллица (строчные)': 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  'казахские буквы': 'ӘәҒғҚқҢңӨөҰұҮүҺһІі',
  латиница: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  цифры: '0123456789',
  знаки: '«»№—–₸.,:;()-/ ',
} as const;

describe('шрифты PDF сертификата', () => {
  for (const file of FONTS) {
    it(`${file}: есть глифы для ru, kz, латиницы, цифр и знаков`, () => {
      const cmap = readCmapCodePoints(readFileSync(path.join(DIR, file)));
      for (const [name, chars] of Object.entries(ALPHABETS)) {
        const missing = codePointsOf(chars).filter((c) => !cmap.has(c));
        assert.deepEqual(
          missing.map((c) => String.fromCodePoint(c)),
          [],
          `${file}: нет символов (${name})`,
        );
      }
    });

    it(`${file}: разбор cmap не принимает всё подряд`, () => {
      const cmap = readCmapCodePoints(readFileSync(path.join(DIR, file)));
      assert.ok(!cmap.has(0x4e2d), 'иероглифа в срезе быть не должно');
      assert.ok(cmap.size > 200 && cmap.size < 1500, `символов: ${cmap.size}`);
    });

    it(`${file}: файл не пустой и легче 120 КБ`, () => {
      const size = readFileSync(path.join(DIR, file)).byteLength;
      assert.ok(size > 10_000 && size < 120_000, `размер ${size}`);
    });
  }

  it('рядом лежат обе лицензии OFL', () => {
    for (const f of ['OFL-Geologica.txt', 'OFL-Onest.txt']) {
      const text = readFileSync(path.join(DIR, f), 'utf8');
      assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/i, f);
    }
  });

  it('хэши файлов совпадают с SHA256SUMS', () => {
    const lines = readFileSync(path.join(DIR, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(lines.length, FONTS.length + 2);
    for (const line of lines) {
      const [hash, name] = line.split(/\s+/);
      const actual = createHash('sha256').update(readFileSync(path.join(DIR, name!))).digest('hex');
      assert.equal(actual, hash, name);
    }
  });

  it('README называет те же хэши, что и SHA256SUMS', () => {
    const readme = readFileSync(path.join(DIR, 'README.md'), 'utf8');
    const sums = readFileSync(path.join(DIR, 'SHA256SUMS'), 'utf8').trim().split('\n');
    for (const line of sums) assert.ok(readme.includes(line.split(/\s+/)[0]!), line);
  });
});
