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
  'расширенная латиница': 'ĞğŞşŪūİıÇçÖöÜüÄäŁłƏə',
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
      assert.ok(cmap.size > 200 && cmap.size < 2000, `символов: ${cmap.size}`);
    });

    it(`${file}: файл не пустой и легче 120 КБ`, () => {
      const size = readFileSync(path.join(DIR, file)).byteLength;
      assert.ok(size > 10_000 && size < 120_000, `размер ${size}`);
    });
  }

  it('срезы статические: нет оси fvar, вес и имя соответствуют срезу', () => {
    const expected: Record<string, [number, string]> = {
      'Geologica-Bold-SHRP100.ttf': [700, 'Geologica-SharpBold'],
      'Onest-Regular.ttf': [400, 'Onest-Regular'],
      'Onest-SemiBold.ttf': [600, 'Onest-SemiBold'],
    };
    for (const file of FONTS) {
      const font = readFileSync(path.join(DIR, file));
      const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
      const tables = new Map<string, number>();
      for (let i = 0; i < view.getUint16(4); i++) {
        const rec = 12 + i * 16;
        tables.set(font.toString('latin1', rec, rec + 4), view.getUint32(rec + 8));
      }
      assert.ok(!tables.has('fvar'), `${file}: остался fvar`);
      assert.equal(view.getUint16(tables.get('OS/2')! + 4), expected[file]![0], `${file}: usWeightClass`);
      // PostScript-имя (nameID 6), платформа Windows (UTF-16BE)
      const name = tables.get('name')!;
      const storage = name + view.getUint16(name + 4);
      let ps = '';
      for (let i = 0; i < view.getUint16(name + 2); i++) {
        const rec = name + 6 + i * 12;
        if (view.getUint16(rec) === 3 && view.getUint16(rec + 6) === 6) {
          const len = view.getUint16(rec + 8);
          const at = storage + view.getUint16(rec + 10);
          for (let k = 0; k < len; k += 2) ps += String.fromCharCode(view.getUint16(at + k));
        }
      }
      assert.equal(ps, expected[file]![1], `${file}: PostScript-имя`);
    }
  });

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
