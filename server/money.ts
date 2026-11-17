import { HttpError } from './errors';

export function toCents(value: unknown, field = 'Amount'): number {
  const numeric =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : (value as number);
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new HttpError(400, `${field} must be a valid number.`);
  }
  if (numeric < 0) throw new HttpError(400, `${field} cannot be negative.`);
  if (numeric > 1_000_000_000) throw new HttpError(400, `${field} is too large.`);
  return Math.round(numeric * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: number): string {
  return fromCents(cents).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}
