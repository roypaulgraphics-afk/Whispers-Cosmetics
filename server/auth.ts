import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { get, run } from './db';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'wc_session';

export interface SessionContext {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  ip: string;
}

interface SessionRow {
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function buildSessionCookie(
  token: string | null,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  if (token === null) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
      options.secure ? '; Secure' : ''
    }`;
  }
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
    options.maxAgeSeconds
  }${options.secure ? '; Secure' : ''}`;
}

export function createSession(
  db: DatabaseSync,
  payload: { ip: string; userAgent: string; days: number },
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + payload.days * 24 * 60 * 60 * 1000);
  run(
    db,
    `INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tokenHash,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
    payload.ip,
    payload.userAgent.slice(0, 300),
  );
  return { token, expiresAt: expires.toISOString() };
}

export function resolveSession(db: DatabaseSync, token: string): SessionContext | null {
  if (!token || token.length < 20) return null;
  const tokenHash = hashToken(token);
  const row = get<SessionRow>(db, 'SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  if (now - new Date(row.last_seen_at).getTime() > 60_000) {
    run(db, 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', new Date(now).toISOString(), tokenHash);
  }
  return {
    tokenHash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ip: row.ip,
  };
}

export function destroySession(db: DatabaseSync, tokenHash: string): void {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

export function destroyOtherSessions(db: DatabaseSync, keepTokenHash: string): number {
  return run(db, 'DELETE FROM sessions WHERE token_hash <> ?', keepTokenHash).changes;
}

export function pruneSessions(db: DatabaseSync): void {
  run(db, 'DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
}

export function sessionMiddleware(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      const session = resolveSession(db, token);
      if (session) {
        res.locals.session = session;
        res.locals.sessionToken = token;
      }
    }
    next();
  };
}

export function requireAuth(_req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.session) {
    res.status(401).json({ error: { message: 'Your register session has expired. Enter the PIN again.', code: 'UNAUTHORIZED' } });
    return;
  }
  next();
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

const FAILURE_WINDOW_MINUTES = 10;
const MAX_FAILURES = 8;

export function loginBlocked(db: DatabaseSync, ip: string): boolean {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const row = get<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM login_attempts WHERE ip = ? AND success = 0 AND created_at >= ?",
    ip,
    since,
  );
  return Number(row?.count ?? 0) >= MAX_FAILURES;
}

export function recordLoginAttempt(db: DatabaseSync, ip: string, success: boolean): void {
  run(
    db,
    'INSERT INTO login_attempts (ip, success, created_at) VALUES (?, ?, ?)',
    ip,
    success ? 1 : 0,
    new Date().toISOString(),
  );
  if (Math.random() < 0.1) {
    run(
      db,
      'DELETE FROM login_attempts WHERE created_at < ?',
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    );
  }
}

export function requirePin(pin: unknown): string {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    throw new HttpError(401, 'Incorrect PIN. Try again.', 'BAD_PIN');
  }
  return pin;
}

export function sameOriginGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.headers.host) {
        next(new HttpError(403, 'Cross-site request blocked.'));
        return;
      }
    } catch {
      next(new HttpError(403, 'Invalid request origin.'));
      return;
    }
  }
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) {
    next(new HttpError(403, 'Cross-site request blocked.'));
    return;
  }
  next();
}

export function securityHeaders(options: { contentSecurityPolicy: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (options.contentSecurityPolicy) {
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob: https:",
          "connect-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; '),
      );
    }
    next();
  };
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function apiRateLimit(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = clientIp(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } });
      return;
    }
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    next();
  };
}
