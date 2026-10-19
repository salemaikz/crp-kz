import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveClientIp, trustedProxyHops, UNKNOWN_IP } from '../../src/lib/auth/clientIp';

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

test('TRUSTED_PROXY_HOPS=0 (по умолчанию): X-Forwarded-For игнорируется', () => {
  const headers = h({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' });
  assert.equal(deriveClientIp(headers, {}), UNKNOWN_IP);
  assert.equal(deriveClientIp(headers, { TRUSTED_PROXY_HOPS: '0' }), UNKNOWN_IP);
});

test('TRUST_X_REAL_IP=1 при 0 хопов: берётся X-Real-IP', () => {
  const env = { TRUST_X_REAL_IP: '1' };
  assert.equal(deriveClientIp(h({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': ' 7.7.7.7 ' }), env), '7.7.7.7');
  assert.equal(deriveClientIp(h({ 'x-real-ip': '2001:DB8::1' }), env), '2001:db8::1');
  assert.equal(deriveClientIp(h({}), env), UNKNOWN_IP);
  assert.equal(deriveClientIp(h({ 'x-real-ip': 'evil<script>' }), env), UNKNOWN_IP);
});

test('N > 0: N-е значение X-Forwarded-For справа; левее — подделка клиента', () => {
  const xff = h({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.2' });
  assert.equal(deriveClientIp(xff, { TRUSTED_PROXY_HOPS: '1' }), '10.0.0.2');
  assert.equal(deriveClientIp(xff, { TRUSTED_PROXY_HOPS: '2' }), '1.2.3.4');
  assert.equal(deriveClientIp(xff, { TRUSTED_PROXY_HOPS: '3' }), '6.6.6.6');
  // значений меньше, чем прокси, — IP неизвестен (запрос пришёл в обход цепочки)
  assert.equal(deriveClientIp(xff, { TRUSTED_PROXY_HOPS: '4' }), UNKNOWN_IP);
  assert.equal(deriveClientIp(h({}), { TRUSTED_PROXY_HOPS: '1' }), UNKNOWN_IP);
  // X-Real-IP при N > 0 не используется
  assert.equal(deriveClientIp(h({ 'x-real-ip': '7.7.7.7' }), { TRUSTED_PROXY_HOPS: '1', TRUST_X_REAL_IP: '1' }), UNKNOWN_IP);
  // порт и скобки IPv6 отбрасываются, мусор — неизвестен
  assert.equal(deriveClientIp(h({ 'x-forwarded-for': '1.2.3.4:5678' }), { TRUSTED_PROXY_HOPS: '1' }), '1.2.3.4');
  assert.equal(deriveClientIp(h({ 'x-forwarded-for': '[2001:db8::2]:443' }), { TRUSTED_PROXY_HOPS: '1' }), '2001:db8::2');
  assert.equal(deriveClientIp(h({ 'x-forwarded-for': '1.2.3.4, a.b' }), { TRUSTED_PROXY_HOPS: '1' }), UNKNOWN_IP);
});

test('TRUSTED_PROXY_HOPS: только целое 0..20', () => {
  assert.equal(trustedProxyHops({}), 0);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' }), 2);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: '-1' }), 0);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: '1.5' }), 0);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: 'yes' }), 0);
  assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: '99' }), 0);
});
