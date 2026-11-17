import { HttpError } from './errors';
import { isDateOnly } from './time';

export function requiredString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required.`);
  const trimmed = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 500;
  if (trimmed.length < min) throw new HttpError(400, `${field} is required.`);
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  options: { max?: number } = {},
): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > (options.max ?? 500)) {
    throw new HttpError(400, `${field} must be at most ${options.max ?? 500} characters.`);
  }
  return trimmed;
}

export function requiredInt(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; fallback?: number } = {},
): number {
  if ((value === undefined || value === null || value === '') && options.fallback !== undefined) {
    return options.fallback;
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpError(400, `${field} must be a whole number.`);
  }
  if (options.min !== undefined && n < options.min) {
    throw new HttpError(400, `${field} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && n > options.max) {
    throw new HttpError(400, `${field} must be at most ${options.max}.`);
  }
  return n;
}

export function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1;
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function isoDateOnly(value: unknown, field: string): string {
  if (!isDateOnly(value)) throw new HttpError(400, `${field} must be a valid date (YYYY-MM-DD).`);
  return value;
}

export function optionalIsoDateOnly(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return isoDateOnly(value, field);
}

export function requireObject(value: unknown, field = 'Request body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}
