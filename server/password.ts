import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors';

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'PIN must be exactly 4 digits.');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  try {
    const actual = scryptSync(pin, salt, expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
