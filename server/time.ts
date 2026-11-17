const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function businessDateFor(date: Date | string, timeZone: string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  const safe = Number.isNaN(value.getTime()) ? new Date() : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(safe);
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function todayFor(timeZone: string): string {
  return businessDateFor(new Date(), timeZone);
}

export function formatBusinessDateLabel(dateOnly: string): string {
  const d = new Date(`${dateOnly}T12:00:00Z`);
  return d.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
