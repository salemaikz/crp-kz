// Сведения о релизе: RELEASE.json, запасные варианты платформ, 'dev'.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadRelease, parseRelease, readRelease } from '../../src/lib/ops/release';

const SHA = 'a'.repeat(40);

test('parseRelease: валидный объект', () => {
  assert.deepEqual(parseRelease({ id: '20261020-101500-v0.3.0', tag: 'v0.3.0', sha: SHA, builtAt: 1760000000000 }), {
    id: '20261020-101500-v0.3.0',
    tag: 'v0.3.0',
    sha: SHA,
    builtAt: 1760000000000,
  });
});

test('parseRelease: лишние поля игнорируются, необязательные — null', () => {
  assert.deepEqual(parseRelease({ id: 'r1', extra: 1 }), { id: 'r1', tag: null, sha: null, builtAt: null });
});

test('parseRelease: плохой sha, плохой id, не объект — null', () => {
  assert.equal(parseRelease({ id: 'r1', sha: 'not-a-sha' }), null);
  assert.equal(parseRelease({ id: 'a/b' }), null);
  assert.equal(parseRelease({ id: '' }), null);
  assert.equal(parseRelease('{"id":"r1"}'), null);
  assert.equal(parseRelease(null), null);
});

test('loadRelease: RELEASE.json из каталога', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-rel-'));
  try {
    await writeFile(path.join(dir, 'RELEASE.json'), JSON.stringify({ id: 'r42', tag: 'v1.0.0', sha: SHA, builtAt: 5 }));
    assert.equal(loadRelease(dir, {}).id, 'r42');
    assert.equal(readRelease(dir, {}).sha, SHA);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadRelease: не JSON и битый файл — запасные варианты', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-rel-'));
  try {
    await writeFile(path.join(dir, 'RELEASE.json'), 'не json');
    assert.equal(loadRelease(dir, {}).id, 'dev');
    await writeFile(path.join(dir, 'RELEASE.json'), JSON.stringify({ id: 'x', sha: 'zzz' }));
    assert.equal(loadRelease(dir, {}).id, 'dev');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadRelease: VERCEL_GIT_COMMIT_SHA и COMMIT_REF (Netlify)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-rel-'));
  try {
    const v = loadRelease(dir, { VERCEL_GIT_COMMIT_SHA: SHA });
    assert.equal(v.id, SHA.slice(0, 12));
    assert.equal(v.sha, SHA);
    const n = loadRelease(dir, { COMMIT_REF: 'b'.repeat(40) });
    assert.equal(n.sha, 'b'.repeat(40));
    assert.equal(loadRelease(dir, { COMMIT_REF: 'мусор' }).id, 'dev');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadRelease: нет ничего — dev', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-rel-'));
  try {
    assert.deepEqual(loadRelease(dir, {}), { id: 'dev', tag: null, sha: null, builtAt: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
