// Адреса файлов: FILE_URL_RE, fileUrl, isUuid, visibleCover.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILE_URL_RE, fileUrl, isUuid, visibleCover } from '../../src/lib/files/url';

const ID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';
const ID2 = 'A0B1C2D3-E4F5-4A6B-8C7D-9E0F1A2B3C4D';

const ids = (text: string) => [...text.matchAll(FILE_URL_RE)].map((m) => m[1]);

test('fileUrl и isUuid', () => {
  assert.equal(fileUrl(ID), `/api/files/${ID}`);
  assert.equal(isUuid(ID), true);
  assert.equal(isUuid(ID2), true, 'верхний регистр');
  for (const bad of ['', 'x', ID + 'a', ' ' + ID, ID.replace(/-/g, ''), '../' + ID]) assert.equal(isUuid(bad), false, bad);
});

test('FILE_URL_RE находит картинку, ссылку, абсолютный адрес и адрес с запросом', () => {
  assert.deepEqual(ids(`![схема](/api/files/${ID})`), [ID]);
  assert.deepEqual(ids(`[файл](/api/files/${ID})`), [ID]);
  assert.deepEqual(ids(`[файл](https://learn.crp.kz/api/files/${ID})`), [ID]);
  assert.deepEqual(ids(`![x](/api/files/${ID}?x=1)`), [ID]);
  assert.deepEqual(ids(`[a](/api/files/${ID}) и ![b](/api/files/${ID2})`), [ID, ID2]);
});

test('FILE_URL_RE не принимает id с лишними символами', () => {
  assert.deepEqual(ids(`/api/files/${ID}a`), [], 'хвост-шестнадцатеричный символ');
  assert.deepEqual(ids(`/api/files/${ID}-1`), [], 'хвост через дефис');
  assert.deepEqual(ids('/api/files/not-a-uuid'), []);
  assert.deepEqual(ids(`/api/other/${ID}`), []);
  assert.deepEqual(ids(`/api/files/${ID.slice(0, -1)}`), [], 'короткий id');
});

test('visibleCover: адрес файла прячется при неактивной загрузке, прочее не трогается', () => {
  const cover = fileUrl(ID);
  assert.equal(visibleCover(cover, true), cover);
  assert.equal(visibleCover(cover, false), null);
  assert.equal(visibleCover(null, true), null);
  assert.equal(visibleCover(null, false), null);
  assert.equal(visibleCover('/covers/a.png', false), '/covers/a.png');
  assert.equal(visibleCover('https://cdn.example/a.png', false), 'https://cdn.example/a.png');
});

test('visibleCover без второго параметра берёт флаг UPLOADS (в тестах — демо, включён)', () => {
  const saved = process.env.FEATURE_UPLOADS;
  try {
    delete process.env.FEATURE_UPLOADS;
    assert.equal(visibleCover(fileUrl(ID)), fileUrl(ID));
    process.env.FEATURE_UPLOADS = '0';
    assert.equal(visibleCover(fileUrl(ID)), null);
  } finally {
    if (saved === undefined) delete process.env.FEATURE_UPLOADS;
    else process.env.FEATURE_UPLOADS = saved;
  }
});
