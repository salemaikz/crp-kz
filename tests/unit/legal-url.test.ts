// Фильтр адресов ссылок в документах: вторая линия защиты от внешних и опасных адресов.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legalUrl } from '../../src/components/legal/LegalMarkdown';

test('legalUrl пропускает http(s), mailto, tel, якоря и относительные адреса', () => {
  for (const ok of ['https://example.test/a', 'http://example.test', 'mailto:a@example.test', 'tel:+70000000000', '#sec', '/legal/offer', '/ru/legal/offer#x'])
    assert.equal(legalUrl(ok), ok);
});

test('legalUrl отбрасывает обходы: //host, /\\host, управляющие символы, javascript:, data:', () => {
  for (const bad of ['//evil.example/x', '/\\evil.example/x', '/\t/evil.example', '/\n/evil.example', ' javascript:alert(1)', 'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '', 'evil.example'])
    assert.equal(legalUrl(bad), '', JSON.stringify(bad));
});
