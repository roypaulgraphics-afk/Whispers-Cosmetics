import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDays } from '../src/lib/format';

type Json = any;

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('store API end-to-end', { timeout: 180_000 }, async (t) => {
  const root = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-api-test-'));
  const port = 4200 + Math.floor(Math.random() * 3000);
  const base = `http://127.0.0.1:${port}`;
  const logs: string[] = [];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: tempDir,
    SEED_LEGACY: 'false',
    DISABLE_HMR: 'true',
    STORE_TIMEZONE: 'Africa/Nairobi',
    CASHIER_NAME: 'Test Register',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'false',
    MANUAL_MPESA_ENABLED: 'true',
    MPESA_ENV: 'sandbox',
    MPESA_SHORTCODE: '',
    MPESA_CONSUMER_KEY: '',
    MPESA_CONSUMER_SECRET: '',
    MPESA_PASSKEY: '',
    MPESA_CALLBACK_URL: '',
    MPESA_CALLBACK_SECRET: '',
    APP_URL: '',
  };

  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));

  let cookie = '';

  const request = async (
    method: string,
    route: string,
    body?: unknown,
    options: { cookie?: string | null; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = {
      Origin: base,
      Accept: 'application/json',
      ...(options.headers ?? {}),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const sessionCookie = options.cookie === undefined ? cookie : options.cookie;
    if (sessionCookie) headers.Cookie = sessionCookie;
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: Json = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed as Json, headers: response.headers };
  };

  const login = async (pin: string) => {
    const result = await request('POST', '/api/auth/login', { pin }, { cookie: null });
    const setCookies = (result.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const session = setCookies.map((value) => value.split(';')[0]).find((value) => value.startsWith('wc_session='));
    if (session) cookie = session;
    return result;
  };

  const getProduct = async (id: string) => {
    const products = await request('GET', '/api/products');
    assert.equal(products.status, 200);
    return products.body.products.find((product: Json) => product.id === id) as Json;
  };

  try {
    const deadline = Date.now() + 60_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!healthy) throw new Error(`Server did not start.\n${logs.join('')}`);

    let today = '';
    let productId = '';
    let cashSaleItemId = '';
    let cashSaleId = '';
    let creditId = '';
    const barcode = `9${String(Date.now()).slice(-12)}`;
    const sku = `TEST-${Date.now().toString(36).toUpperCase()}`;
    const mpesaCode = `T${Date.now().toString(36).toUpperCase().slice(-7)}`;
    const creditMpesaCode = `C${Date.now().toString(36).toUpperCase().slice(-7)}`;

    await t.test('health, lock screen and authentication', async () => {
      const health = await request('GET', '/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.body.status, 'ok');

      const lockedBootstrap = await request('GET', '/api/bootstrap', undefined, { cookie: null });
      assert.equal(lockedBootstrap.status, 401);

      const session = await request('GET', '/api/session', undefined, { cookie: null });
      assert.equal(session.status, 200);
      assert.equal(session.body.authenticated, false);
      assert.ok(session.body.store.storeName);

      const badLogin = await login('9999');
      assert.equal(badLogin.status, 401);
      assert.equal(badLogin.body.error.code, 'BAD_PIN');

      const goodLogin = await login('1234');
      assert.equal(goodLogin.status, 200);
      assert.equal(goodLogin.body.authenticated, true);
      assert.equal(goodLogin.body.pinIsDefault, true);
      assert.match(cookie, /^wc_session=/);

      const authedSession = await request('GET', '/api/session');
      assert.equal(authedSession.body.authenticated, true);
      assert.equal(authedSession.body.pinIsDefault, true);
    });

    await t.test('bootstrap starts with an empty seeded store', async () => {
      const result = await request('GET', '/api/bootstrap');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.products, []);
      assert.deepEqual(result.body.credits, []);
      assert.equal(result.body.mpesa.configured, false);
      assert.equal(result.body.mpesa.manualEnabled, true);
      assert.match(result.body.meta.today, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof result.body.settings.storeName, 'string');
      today = result.body.meta.today;
    });

    await t.test('product creation, duplicate guard, restock and stock ledger', async () => {
      const created = await request('POST', '/api/products', {
        name: 'Test Shea Butter',
        brand: 'Whispers',
        category: 'Lotion',
        costPrice: 100,
        basePrice: 300,
        currentPrice: 300,
        stock: 10,
        reorderLevel: 3,
        barcode,
        sku,
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.product.name, 'Test Shea Butter');
      assert.equal(created.body.product.stock, 10);
      assert.equal(created.body.product.currentPrice, 300);
      assert.equal(created.body.product.costPrice, 100);
      assert.equal(created.body.product.barcode, barcode);
      productId = created.body.product.id;

      const duplicate = await request('POST', '/api/products', {
        name: 'Duplicate',
        category: 'Lotion',
        costPrice: 100,
        currentPrice: 200,
        stock: 1,
        barcode,
      });
      assert.equal(duplicate.status, 409);
      assert.match(duplicate.body.error.message, /barcode/);

      const restocked = await request('POST', `/api/products/${productId}/restock`, {
        quantity: 2,
        unitCost: 120,
        note: 'Delivery',
      });
      assert.equal(restocked.status, 200);
      assert.equal(restocked.body.product.stock, 12);
      assert.equal(restocked.body.product.costPrice, 120);
      assert.equal(restocked.body.movement.delta, 2);
      assert.equal(restocked.body.movement.reason, 'restock');

      const movements = await request('GET', `/api/products/${productId}/movements?limit=10`);
      assert.equal(movements.status, 200);
      const reasons = movements.body.movements.map((movement: Json) => movement.reason);
      assert.ok(reasons.includes('opening'));
      assert.ok(reasons.includes('restock'));
    });

    await t.test('cash sale, stock decrement and change calculation', async () => {
      const sale = await request('POST', '/api/sales', {
        items: [{ productId, quantity: 2 }],
        paymentMode: 'Cash',
        cashTendered: 700,
      });
      assert.equal(sale.status, 201);
      assert.match(sale.body.sale.receiptNo, /^WC-\d+$/);
      assert.equal(sale.body.sale.totalAmount, 600);
      assert.equal(sale.body.sale.cashTendered, 700);
      assert.equal(sale.body.sale.changeGiven, 100);
      assert.equal(sale.body.sale.status, 'Completed');
      assert.equal(sale.body.sale.cashier, 'Test Register');
      cashSaleId = sale.body.sale.id;
      cashSaleItemId = sale.body.sale.items[0].id;

      const product = await getProduct(productId);
      assert.equal(product.stock, 10);

      const tooMany = await request('POST', '/api/sales', {
        items: [{ productId, quantity: 99 }],
        paymentMode: 'Cash',
      });
      assert.equal(tooMany.status, 400);
      assert.match(tooMany.body.error.message, /stock/);

      const listed = await request('GET', '/api/sales?limit=5');
      assert.equal(listed.status, 200);
      assert.equal(listed.body.sales[0].receiptNo, sale.body.sale.receiptNo);
    });

    await t.test('partial refund restocks and prorates the total', async () => {
      const refund = await request('POST', `/api/sales/${cashSaleId}/refunds`, {
        items: [{ saleItemId: cashSaleItemId, quantity: 1 }],
        method: 'Cash',
        reason: 'Customer changed mind',
        restock: true,
      });
      assert.equal(refund.status, 201);
      assert.match(refund.body.refund.refundNo, /^RF-\d+$/);
      assert.equal(refund.body.refund.totalAmount, 300);
      assert.equal(refund.body.refund.restocked, true);
      assert.equal(refund.body.sale.status, 'Partially Refunded');
      assert.equal(refund.body.sale.items[0].refundedQuantity, 1);

      const product = await getProduct(productId);
      assert.equal(product.stock, 11);

      const excess = await request('POST', `/api/sales/${cashSaleId}/refunds`, {
        items: [{ saleItemId: cashSaleItemId, quantity: 5 }],
        method: 'Cash',
        reason: 'Too many',
      });
      assert.equal(excess.status, 400);

      const refunds = await request('GET', '/api/refunds');
      assert.equal(refunds.status, 200);
      assert.equal(refunds.body.refunds.length, 1);
    });

    await t.test('manual M-Pesa sale and duplicate-code protection', async () => {
      const sale = await request('POST', '/api/sales', {
        items: [{ productId, quantity: 1 }],
        paymentMode: 'Mpesa',
        mpesa: {
          transactionCode: mpesaCode,
          amountReceived: 300,
          senderName: 'Test Payer',
          senderPhone: '0722000000',
        },
      });
      assert.equal(sale.status, 201);
      assert.equal(sale.body.sale.totalAmount, 300);
      assert.equal(sale.body.sale.mpesaDetails.transactionCode, mpesaCode);
      assert.equal(sale.body.sale.mpesaDetails.mode, 'manual');

      const duplicate = await request('POST', '/api/sales', {
        items: [{ productId, quantity: 1 }],
        paymentMode: 'Mpesa',
        mpesa: { transactionCode: mpesaCode, amountReceived: 300 },
      });
      assert.equal(duplicate.status, 409);
      assert.match(duplicate.body.error.message, /already been recorded/);

      const product = await getProduct(productId);
      assert.equal(product.stock, 10);
    });

    await t.test('credit sale, deposit and mixed payments', async () => {
      const sale = await request('POST', '/api/sales', {
        items: [{ productId, quantity: 2 }],
        paymentMode: 'Credit',
        credit: {
          customerName: 'Test Customer',
          customerPhone: '0712345678',
          dueDate: addDays(today, 7),
          amountPaid: 100,
          paymentMethod: 'Cash',
        },
      });
      assert.equal(sale.status, 201);
      assert.equal(sale.body.credit.totalAmount, 600);
      assert.equal(sale.body.credit.amountPaid, 100);
      assert.equal(sale.body.credit.saleId, sale.body.sale.id);
      assert.equal(sale.body.deposit.amount, 100);
      creditId = sale.body.credit.id;

      const cashPayment = await request('POST', `/api/credits/${creditId}/payments`, {
        amount: 50,
        method: 'Cash',
      });
      assert.equal(cashPayment.status, 201);
      assert.equal(cashPayment.body.credit.amountPaid, 150);

      const mpesaPayment = await request('POST', `/api/credits/${creditId}/payments`, {
        amount: 50,
        method: 'Mpesa',
        mpesa: { transactionCode: creditMpesaCode, amountReceived: 50 },
      });
      assert.equal(mpesaPayment.status, 201);
      assert.equal(mpesaPayment.body.credit.amountPaid, 200);
      assert.equal(mpesaPayment.body.credit.payments.length, 3);

      const overpay = await request('POST', `/api/credits/${creditId}/payments`, {
        amount: 1000,
        method: 'Cash',
      });
      assert.equal(overpay.status, 400);
      assert.match(overpay.body.error.message, /outstanding balance/);

      const credits = await request('GET', '/api/credits');
      const stored = credits.body.credits.find((credit: Json) => credit.id === creditId);
      assert.equal(stored.amountPaid, 200);
      assert.equal(stored.creditorName, 'Test Customer');

      const product = await getProduct(productId);
      assert.equal(product.stock, 8);
    });

    await t.test('reports, pricing and audit trail', async () => {
      const report = await request('GET', `/api/reports?from=${today}&to=${today}`);
      assert.equal(report.status, 200);
      assert.equal(report.body.report.totals.salesCount, 3);
      assert.equal(report.body.report.totals.grossSales, 1500);
      assert.equal(report.body.report.totals.refunds, 300);
      assert.equal(report.body.report.totals.netSales, 1200);
      assert.equal(report.body.report.refunds.length, 1);

      const invalidRange = await request('GET', `/api/reports?from=${today}&to=2020-01-01`);
      assert.equal(invalidRange.status, 400);

      const pricing = await request('GET', '/api/pricing');
      assert.equal(pricing.status, 200);
      assert.ok(Array.isArray(pricing.body.recommendations));

      const audit = await request('GET', '/api/audit?limit=100');
      assert.equal(audit.status, 200);
      assert.ok(audit.body.total >= 10);
      const actions = audit.body.entries.map((entry: Json) => entry.action);
      for (const expected of ['auth.login', 'product.create', 'sale.create', 'sale.refund', 'credit.payment']) {
        assert.ok(actions.includes(expected), `audit should include ${expected}`);
      }

      const filtered = await request('GET', '/api/audit?action=sale.refund');
      assert.ok(filtered.body.entries.every((entry: Json) => entry.action === 'sale.refund'));
      assert.equal(filtered.body.entries.length, 1);
    });

    await t.test('image upload and static serving', async () => {
      const upload = await request('POST', '/api/uploads', { dataUrl: TINY_PNG, kind: 'logo' });
      assert.equal(upload.status, 201);
      assert.match(upload.body.url, /^\/uploads\/.+\.png$/);
      const image = await fetch(`${base}${upload.body.url}`);
      assert.equal(image.status, 200);
      assert.match(image.headers.get('content-type') ?? '', /^image\/png/);
    });

    await t.test('manual backups can be created, listed and downloaded', async () => {
      const created = await request('POST', '/api/backups');
      assert.equal(created.status, 201);
      assert.match(created.body.backup.name, /\.db$/);
      assert.ok(created.body.backup.size > 0);

      const listed = await request('GET', '/api/backups');
      assert.ok(listed.body.backups.some((backup: Json) => backup.name === created.body.backup.name));

      const download = await fetch(`${base}/api/backups/${created.body.backup.name}/download`, {
        headers: { Cookie: cookie },
      });
      assert.equal(download.status, 200);
      assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
      const bytes = await download.arrayBuffer();
      assert.ok(bytes.byteLength > 0);

      const traversal = await request('GET', '/api/backups/..%2Fwhispers.db/download');
      assert.equal(traversal.status, 404);
    });

    await t.test('unconfigured Daraja rejects STK Push cleanly', async () => {
      const result = await request('POST', '/api/mpesa/stkpush', { phone: '0712345678', amount: 100 });
      assert.equal(result.status, 503);
      assert.equal(result.body.error.code, 'MPESA_NOT_CONFIGURED');
    });

    await t.test('settings update and PIN change revoke other sessions', async () => {
      const updated = await request('PATCH', '/api/settings', { storeName: 'Whispers Test Store' });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.settings.storeName, 'Whispers Test Store');

      const wrongCurrent = await request('POST', '/api/settings/pin', {
        currentPin: '0000',
        newPin: '4321',
      });
      assert.equal(wrongCurrent.status, 401);

      const changed = await request('POST', '/api/settings/pin', {
        currentPin: '1234',
        newPin: '4321',
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.pinIsDefault, false);

      const stillAuthed = await request('GET', '/api/bootstrap');
      assert.equal(stillAuthed.status, 200);

      const logout = await request('POST', '/api/auth/logout');
      assert.equal(logout.status, 200);

      const afterLogout = await request('GET', '/api/bootstrap');
      assert.equal(afterLogout.status, 401);

      const oldPin = await login('1234');
      assert.equal(oldPin.status, 401);
      assert.equal(oldPin.body.error.code, 'BAD_PIN');

      const newPin = await login('4321');
      assert.equal(newPin.status, 200);
      assert.equal(newPin.body.pinIsDefault, false);
    });
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 8000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
