// Детерминированные UUID для сида: одинаковые id в любом экземпляре демо.
import { createHash } from 'node:crypto';

/** Пространство имён сида ЦРП (произвольный фиксированный UUID). */
const SEED_NAMESPACE = 'c4b1f0a2-3d5e-4f60-8a71-0b2c3d4e5f60';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** UUID v5 (SHA-1) от пары (ns, key) в пространстве сида. Стабилен между запусками и версиями. */
export function seedId(ns: string, key: string): string {
  const hash = createHash('sha1')
    .update(uuidBytes(SEED_NAMESPACE))
    .update(`${ns}:${key}`, 'utf8')
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x50; // версия 5
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // вариант RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
