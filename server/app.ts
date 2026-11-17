import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { AppMeta, SessionInfo } from '../src/types';
import { config, uploadsDir } from './config';
import { HttpError } from './errors';
import {
  buildSessionCookie,
  clientIp,
  createSession,
  destroySession,
  loginBlocked,
  pruneSessions,
  recordLoginAttempt,
  requireAuth,
  requirePin,
  sameOriginGuard,
  securityHeaders,
  sessionMiddleware,
  apiRateLimit,
} from './auth';
import { verifyPin } from './password';
import { toCents } from './money';
import { isoDateOnly, oneOf, optionalString, requireObject, requiredInt } from './validation';
import { nowIso, todayFor } from './time';
import { logAudit } from './audit';
import {
  getSettings,
  getSettingsRow,
  changePin,
  publicBranding,
  removeLogoFile,
  updateSettings,
} from './services/settings';
import {
  adjustStockCount,
  createProduct,
  listProducts,
  listStockMovements,
  recentMovements,
  restockProduct,
  setProductArchived,
  updateProduct,
} from './services/products';
import { saveUploadedImage, deleteUploadedImage } from './services/uploads';
import { createRefund, createSale, getSale, listRefunds, listSales } from './services/sales';
import { getCredit, listCredits, recordCreditPayment, updateCredit } from './services/credits';
import { getOverview, getPricingRecommendations, getReport } from './services/reports';
import { listAudit } from './services/audit';
import { createBackupNow, listBackups, resolveBackup } from './services/backup';
import {
  callbackSecretMatches,
  handleStkCallback,
  initiateStkPush,
  mpesaClientInfo,
  refreshIntentStatus,
} from './mpesa';

export interface CreateAppOptions {
  dev?: boolean;
  vite?: RequestHandler;
}

function meta(): AppMeta {
  return {
    today: todayFor(config.timezone),
    serverTime: nowIso(),
    timezone: config.timezone,
    version: config.version,
    appName: config.appName,
  };
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function queryLimit(value: unknown, fallback: number, max = 200): number {
  if (value === undefined || value === null || value === '') return fallback;
  return requiredInt(value, 'Limit', { min: 1, max });
}

export function createApp(db: DatabaseSync, options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders({ contentSecurityPolicy: config.isProduction }));
  app.use(express.json({ limit: '6mb' }));
  app.use(sessionMiddleware(db));
  app.use(sameOriginGuard);

  app.use(
    '/uploads',
    express.static(uploadsDir(), {
      index: false,
      maxAge: '30d',
      immutable: true,
      dotfiles: 'deny',
    }),
  );

  const api = express.Router();
  api.use(apiRateLimit({ windowMs: 60_000, max: 1500 }));

  api.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', version: config.version, time: nowIso() });
  });

  api.get('/session', (_req, res) => {
    const branding = publicBranding(db);
    const authenticated = Boolean(res.locals.session);
    const body: SessionInfo = {
      authenticated,
      store: {
        storeName: branding.storeName,
        logoUrl: branding.logoUrl,
        currency: branding.currency,
        theme: branding.theme,
      },
      ...(authenticated ? { pinIsDefault: branding.pinIsDefault } : {}),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  api.post(
    '/auth/login',
    apiRateLimit({ windowMs: 60_000, max: 12 }),
    (req, res) => {
      const ip = clientIp(req);
      if (loginBlocked(db, ip)) {
        res.setHeader('Retry-After', '600');
        throw new HttpError(429, 'Too many incorrect PIN attempts. Try again in 10 minutes.', 'LOGIN_BLOCKED');
      }
      const body = requireObject(req.body);
      const pin = requirePin(body.pin);
      const row = getSettingsRow(db);
      if (!verifyPin(pin, row.pin_hash)) {
        recordLoginAttempt(db, ip, false);
        logAudit(db, {
          action: 'auth.login_failed',
          entityType: 'session',
          entityId: ip,
          ip,
        });
        throw new HttpError(401, 'Incorrect PIN. Try again.', 'BAD_PIN');
      }
      recordLoginAttempt(db, ip, true);
      pruneSessions(db);
      const session = createSession(db, {
        ip,
        userAgent: req.headers['user-agent'] ?? '',
        days: config.sessionDays,
      });
      res.setHeader(
        'Set-Cookie',
        buildSessionCookie(session.token, {
          secure: config.cookieSecure,
          maxAgeSeconds: config.sessionDays * 24 * 60 * 60,
        }),
      );
      logAudit(db, {
        action: 'auth.login',
        entityType: 'session',
        entityId: ip,
        ip,
      });
      const branding = publicBranding(db);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        authenticated: true,
        store: {
          storeName: branding.storeName,
          logoUrl: branding.logoUrl,
          currency: branding.currency,
          theme: branding.theme,
        },
        pinIsDefault: branding.pinIsDefault,
        expiresAt: session.expiresAt,
      });
    },
  );

  api.post('/auth/logout', (req, res) => {
    const session = res.locals.session as { tokenHash: string } | undefined;
    if (session) {
      destroySession(db, session.tokenHash);
      logAudit(db, {
        action: 'auth.logout',
        entityType: 'session',
        entityId: session.tokenHash.slice(0, 12),
        ip: clientIp(req),
      });
    }
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(null, { secure: config.cookieSecure, maxAgeSeconds: 0 }),
    );
    res.json({ ok: true });
  });

  api.post(
    '/mpesa/callback/:secret',
    apiRateLimit({ windowMs: 60_000, max: 120 }),
    (req, res) => {
      const expected = config.mpesa.callbackSecret;
      if (!expected || !callbackSecretMatches(expected, req.params.secret)) {
        throw new HttpError(404, 'Not found.');
      }
      handleStkCallback(db, req.body, config);
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    },
  );

  api.use(requireAuth);

  const requireSessionData = (res: Response): { tokenHash: string } =>
    res.locals.session as { tokenHash: string };

  api.get('/meta', (_req, res) => {
    res.json(meta());
  });

  api.get('/bootstrap', (_req, res) => {
    res.json({
      products: listProducts(db),
      credits: listCredits(db),
      settings: getSettings(db),
      meta: meta(),
      mpesa: mpesaClientInfo(config),
      overview: getOverview(db, config),
    });
  });

  api.get('/products', (_req, res) => {
    res.json({ products: listProducts(db) });
  });

  api.post('/products', (req, res) => {
    const body = requireObject(req.body);
    const product = createProduct(db, body, config.timezone, clientIp(req));
    res.status(201).json({ product });
  });

  api.patch('/products/:id', (req, res) => {
    const body = requireObject(req.body);
    const product = updateProduct(db, req.params.id, body, config.timezone, clientIp(req));
    res.json({ product });
  });

  api.post('/products/:id/archive', (req, res) => {
    const body = requireObject(req.body);
    const archived = body.archived !== false;
    const product = setProductArchived(db, req.params.id, archived, clientIp(req));
    res.json({ product });
  });

  api.post('/products/:id/restock', (req, res) => {
    const body = requireObject(req.body);
    res.json(restockProduct(db, req.params.id, body, config.timezone, clientIp(req)));
  });

  api.post('/products/:id/adjust-stock', (req, res) => {
    const body = requireObject(req.body);
    res.json(adjustStockCount(db, req.params.id, body, config.timezone, clientIp(req)));
  });

  api.get('/products/:id/movements', (req, res) => {
    const limit = queryLimit(req.query.limit, 100, 500);
    res.json({ movements: listStockMovements(db, req.params.id, limit) });
  });

  api.get('/movements', (req, res) => {
    const limit = queryLimit(req.query.limit, 50, 200);
    res.json({ movements: recentMovements(db, limit) });
  });

  api.post('/uploads', (req, res) => {
    const body = requireObject(req.body);
    res.status(201).json(saveUploadedImage(db, body, clientIp(req)));
  });

  api.delete('/uploads', (req, res) => {
    const url = queryString(req.query.url);
    if (!url) throw new HttpError(400, 'An upload URL is required.');
    deleteUploadedImage(db, url, clientIp(req));
    res.json({ ok: true });
  });

  api.post('/sales', (req, res) => {
    const body = requireObject(req.body);
    const result = createSale(db, body, {
      config,
      cashier: config.cashierName,
      ip: clientIp(req),
    });
    res.status(201).json(result);
  });

  api.get('/sales', (req, res) => {
    const mode =
      queryString(req.query.mode) === undefined
        ? undefined
        : oneOf(req.query.mode, ['Cash', 'Mpesa', 'Credit'] as const, 'Payment mode');
    const status =
      queryString(req.query.status) === undefined
        ? undefined
        : oneOf(
            req.query.status,
            ['Completed', 'Partially Refunded', 'Refunded'] as const,
            'Sale status',
          );
    const result = listSales(db, {
      from: queryString(req.query.from),
      to: queryString(req.query.to),
      mode,
      status,
      search: optionalString(req.query.q, 'Search', { max: 100 }) || undefined,
      limit: queryLimit(req.query.limit, 50, 200),
      offset: req.query.offset
        ? requiredInt(req.query.offset, 'Offset', { min: 0, max: 1_000_000 })
        : 0,
    });
    res.json(result);
  });

  api.get('/sales/:id', (req, res) => {
    res.json({ sale: getSale(db, req.params.id) });
  });

  api.post('/sales/:id/refunds', (req, res) => {
    const body = requireObject(req.body);
    const result = createRefund(db, req.params.id, body, {
      config,
      cashier: config.cashierName,
      ip: clientIp(req),
    });
    res.status(201).json(result);
  });

  api.get('/refunds', (req, res) => {
    res.json({
      refunds: listRefunds(db, {
        from: queryString(req.query.from),
        to: queryString(req.query.to),
        limit: queryLimit(req.query.limit, 100, 500),
      }),
    });
  });

  api.get('/credits', (_req, res) => {
    res.json({ credits: listCredits(db) });
  });

  api.get('/credits/:id', (req, res) => {
    res.json({ credit: getCredit(db, req.params.id) });
  });

  api.patch('/credits/:id', (req, res) => {
    const body = requireObject(req.body);
    res.json({ credit: updateCredit(db, req.params.id, body, clientIp(req)) });
  });

  api.post('/credits/:id/payments', (req, res) => {
    const body = requireObject(req.body);
    res
      .status(201)
      .json(
        recordCreditPayment(
          db,
          req.params.id,
          {
            amount: body.amount,
            method: body.method,
            mpesa: body.mpesa,
            note: body.note,
          },
          config,
          clientIp(req),
        ),
      );
  });

  api.get('/reports/overview', (_req, res) => {
    res.json({ overview: getOverview(db, config) });
  });

  api.get('/pricing', (_req, res) => {
    res.json({ recommendations: getPricingRecommendations(db, config) });
  });

  api.get('/reports', (req, res) => {
    const from = isoDateOnly(queryString(req.query.from) ?? todayFor(config.timezone), 'From date');
    const to = isoDateOnly(queryString(req.query.to) ?? todayFor(config.timezone), 'To date');
    if (from > to) throw new HttpError(400, 'The start date must be on or before the end date.');
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > 366) throw new HttpError(400, 'Report ranges are limited to 366 days.');
    res.json({ report: getReport(db, config, from, to) });
  });

  api.get('/audit', (req, res) => {
    res.json(
      listAudit(db, {
        limit: queryLimit(req.query.limit, 50, 200),
        offset: req.query.offset
          ? requiredInt(req.query.offset, 'Offset', { min: 0, max: 1_000_000 })
          : 0,
        search: optionalString(req.query.q, 'Search', { max: 100 }) || undefined,
        action: optionalString(req.query.action, 'Action', { max: 100 }) || undefined,
        from: queryString(req.query.from),
        to: queryString(req.query.to),
      }),
    );
  });

  api.get('/backups', (_req, res) => {
    res.json({ backups: listBackups() });
  });

  api.post('/backups', (req, res) => {
    const backup = createBackupNow(db);
    if (!backup) throw new HttpError(500, 'The database file could not be backed up.');
    logAudit(db, {
      action: 'backup.create',
      entityType: 'backup',
      entityId: backup.name,
      details: { size: backup.size },
      ip: clientIp(req),
    });
    res.status(201).json({ backup });
  });

  api.get('/backups/:name/download', (req, res) => {
    const backup = resolveBackup(req.params.name);
    if (!backup) throw new HttpError(404, 'Backup not found.');
    logAudit(db, {
      action: 'backup.download',
      entityType: 'backup',
      entityId: backup.info.name,
      ip: clientIp(req),
    });
    res.download(backup.absolute, backup.info.name);
  });

  api.get('/settings', (_req, res) => {
    res.json({ settings: getSettings(db) });
  });

  api.patch('/settings', (req, res) => {
    const body = requireObject(req.body);
    const before = getSettings(db);
    const settings = updateSettings(db, body, clientIp(req));
    if (before.logoUrl && before.logoUrl !== settings.logoUrl) {
      removeLogoFile(before.logoUrl);
    }
    res.json({ settings });
  });

  api.post('/settings/pin', (req, res) => {
    const body = requireObject(req.body);
    const session = requireSessionData(res);
    const result = changePin(db, body, session.tokenHash, clientIp(req));
    res.json({ ...result, pinIsDefault: false });
  });

  api.get('/mpesa', (_req, res) => {
    res.json({ mpesa: mpesaClientInfo(config) });
  });

  api.post(
    '/mpesa/stkpush',
    apiRateLimit({ windowMs: 60_000, max: 20 }),
    asyncHandler(async (req, res) => {
      const body = requireObject(req.body);
      const amountCents = toCents(body.amount, 'Amount');
      const purpose =
        body.purpose === undefined
          ? 'sale'
          : oneOf(body.purpose, ['sale', 'credit'] as const, 'Payment purpose');
      const accountReference = optionalString(body.accountReference, 'Account reference', { max: 30 });
      const result = await initiateStkPush(db, config, {
        phone: body.phone,
        amountCents,
        purpose,
        accountReference,
        ip: clientIp(req),
      });
      res.status(201).json(result);
    }),
  );

  api.get(
    '/mpesa/status/:intentId',
    asyncHandler(async (req, res) => {
      const intent = await refreshIntentStatus(db, config, req.params.intentId);
      res.json({ intent });
    }),
  );

  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'API endpoint not found.', code: 'NOT_FOUND' } });
  });

  if (options.dev) {
    if (options.vite) app.use(options.vite);
  } else {
    const indexFile = path.join(config.distDir, 'index.html');
    app.use(
      express.static(config.distDir, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
        next();
        return;
      }
      if (!req.accepts('html') || !fs.existsSync(indexFile)) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(indexFile);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found.', code: 'NOT_FOUND' } });
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: { message: error.message, ...(error.code ? { code: error.code } : {}) },
      });
      return;
    }
    const typed = error as { type?: string; status?: number; message?: string };
    if (typed?.type === 'entity.too.large' || typed?.status === 413) {
      res.status(413).json({ error: { message: 'The request is too large.' } });
      return;
    }
    if (typed?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { message: 'The request body is not valid JSON.' } });
      return;
    }
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}`, error);
    res.status(500).json({ error: { message: 'Something went wrong on the server.' } });
  });

  return app;
}
