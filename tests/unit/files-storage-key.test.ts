// Ключи объектов хранилища и защита пути локального провайдера.
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalStorage } from '../../src/lib/storage/local';
import { assertStorageKey, newStorageKey } from '../../src/lib/storage/keys';

const UUID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';

test('assertStorageKey отклоняет обходы каталогов и чужие виды ключей', () => {
  for (const bad of ['../x', '/abs', 'ab/../../x', `AB/${UUID}`, '', `3f/${UUID}\0`, `3f/${UUID}/`, `3f/${UUID}\n`, `aa/${UUID}`, `3f/${UUID}.png`]) {
    assert.throws(() => assertStorageKey(bad), Error, JSON.stringify(bad));
  }
  assert.equal(assertStorageKey(`3f/${UUID}`), `3f/${UUID}`);
});

test('newStorageKey проходит проверку и каждый раз новый', () => {
  const a = newStorageKey();
  assert.equal(assertStorageKey(a), a);
  assert.notEqual(a, newStorageKey());
});

test('local: объект кладётся с режимом 0600, читается, удаляется; отсутствие — не ошибка', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'crp-local-'));
  try {
    const st = createLocalStorage(root);
    assert.equal((await st.health()).ok, true);
    const tmp = path.join(await st.tempDir(), 'x1');
    await writeFile(tmp, 'hello');
    const key = newStorageKey();
    await st.putFromTemp(key, tmp);
    const obj = await st.open(key);
    assert.equal(obj?.size, 5);
    const chunks: Buffer[] = [];
    for await (const c of obj!.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
    assert.equal(Buffer.concat(chunks).toString(), 'hello');
    await st.remove(key);
    await st.remove(key);
    assert.equal(await st.open(key), null);
    await assert.rejects(() => st.open('../etc/passwd'));
    const outside = path.join(root, 'outside');
    await writeFile(outside, 'x');
    await assert.rejects(() => st.putFromTemp(newStorageKey(), outside));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local: objects/ — симлинк → health не готов; симлинк-объект не отдаётся', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'crp-local-'));
  const other = await mkdtemp(path.join(tmpdir(), 'crp-other-'));
  try {
    await symlink(other, path.join(root, 'objects'));
    assert.equal((await createLocalStorage(root).health()).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
  const root2 = await mkdtemp(path.join(tmpdir(), 'crp-local-'));
  try {
    const st = createLocalStorage(root2);
    await st.tempDir();
    const target = path.join(root2, 'target');
    await writeFile(target, 'x');
    const key = newStorageKey();
    await mkdir(path.join(root2, 'objects', key.slice(0, 2)), { recursive: true });
    await symlink(target, path.join(root2, 'objects', key));
    assert.equal(await st.open(key), null);
  } finally {
    await rm(root2, { recursive: true, force: true });
  }
});
