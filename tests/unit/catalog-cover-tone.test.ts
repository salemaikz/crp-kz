import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COVER_TONES, toneFor } from '../../src/lib/catalog/tone';

test('тон зависит только от slug и стабилен', () => {
  assert.equal(toneFor('celina'), toneFor('celina'));
  assert.ok((COVER_TONES as readonly string[]).includes(toneFor('любой-slug')));
});

test('курсы сида получают разные тоны', () => {
  const slugs = ['celina', 'sales-doubling', 'razbor', 'operator-onboarding'];
  const tones = new Set(slugs.map(toneFor));
  assert.equal(tones.size, slugs.length);
});
