import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashPin } from './password';

export type SqlParam = string | number | bigint | null;
export type Row = Record<string, string | number | null>;

export function openDatabase(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        store_name TEXT NOT NULL,
        logo_url TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'Ksh',
        mpesa_till_number TEXT NOT NULL DEFAULT '',
        auto_dynamic_enabled INTEGER NOT NULL DEFAULT 0,
        theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
        receipt_footer TEXT NOT NULL DEFAULT 'Thank you for shopping with us.',
        pin_hash TEXT NOT NULL,
        pin_is_default INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
        barcode TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        cost_price_cents INTEGER NOT NULL CHECK (cost_price_cents >= 0),
        base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
        current_price_cents INTEGER NOT NULL CHECK (current_price_cents >= 0),
        auto_dynamic INTEGER NOT NULL DEFAULT 1,
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
        is_perishable INTEGER NOT NULL DEFAULT 0,
        expiry_date TEXT,
        image_url TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_products_category ON products(category);
      CREATE INDEX idx_products_archived ON products(archived);

      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        receipt_no TEXT NOT NULL UNIQUE,
        subtotal_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL,
        payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash', 'Mpesa', 'Credit')),
        mpesa_code TEXT UNIQUE,
        mpesa_phone TEXT,
        mpesa_sender_name TEXT,
        mpesa_raw_message TEXT,
        mpesa_intent_id TEXT,
        credit_id TEXT,
        cash_tendered_cents INTEGER,
        change_cents INTEGER,
        status TEXT NOT NULL DEFAULT 'Completed' CHECK (status IN ('Completed', 'Partially Refunded', 'Refunded')),
        cashier TEXT NOT NULL DEFAULT 'Register',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        business_date TEXT NOT NULL
      );
      CREATE INDEX idx_sales_business_date ON sales(business_date);
      CREATE INDEX idx_sales_created_at ON sales(created_at);
      CREATE INDEX idx_sales_payment_mode ON sales(payment_mode);

      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL,
        cost_price_cents INTEGER NOT NULL,
        refunded_quantity INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
      CREATE INDEX idx_sale_items_product ON sale_items(product_id);

      CREATE TABLE refunds (
        id TEXT PRIMARY KEY,
        refund_no TEXT NOT NULL UNIQUE,
        sale_id TEXT NOT NULL REFERENCES sales(id),
        total_cents INTEGER NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('Cash', 'Mpesa')),
        reason TEXT NOT NULL DEFAULT '',
        restocked INTEGER NOT NULL DEFAULT 1,
        business_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_refunds_sale ON refunds(sale_id);
      CREATE INDEX idx_refunds_business_date ON refunds(business_date);

      CREATE TABLE refund_items (
        id TEXT PRIMARY KEY,
        refund_id TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
        sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL,
        restock INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_refund_items_refund ON refund_items(refund_id);

      CREATE TABLE credits (
        id TEXT PRIMARY KEY,
        creditor_name TEXT NOT NULL,
        creditor_phone TEXT NOT NULL DEFAULT '',
        pending_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        items_json TEXT NOT NULL DEFAULT '[]',
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
        notes TEXT NOT NULL DEFAULT '',
        sale_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_credits_created_at ON credits(created_at);

      CREATE TABLE credit_payments (
        id TEXT PRIMARY KEY,
        credit_id TEXT NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        method TEXT NOT NULL CHECK (method IN ('Cash', 'Mpesa')),
        mpesa_code TEXT UNIQUE,
        mpesa_phone TEXT,
        mpesa_sender_name TEXT,
        mpesa_raw_message TEXT,
        note TEXT NOT NULL DEFAULT '',
        paid_at TEXT NOT NULL,
        business_date TEXT NOT NULL
      );
      CREATE INDEX idx_credit_payments_credit ON credit_payments(credit_id);

      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('opening', 'sale', 'refund', 'restock', 'adjustment', 'credit')),
        reference_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        business_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, created_at);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_log(created_at);

      CREATE TABLE mpesa_intents (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('sale', 'credit')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled', 'timeout', 'error')),
        result_code TEXT,
        result_desc TEXT,
        mpesa_receipt TEXT,
        merchant_request_id TEXT,
        checkout_request_id TEXT UNIQUE,
        raw_callback TEXT,
        used_by_type TEXT,
        used_by_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_mpesa_intents_status ON mpesa_intents(status);
      CREATE UNIQUE INDEX idx_mpesa_intents_receipt ON mpesa_intents(mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;

      CREATE TABLE counters (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE refunds ADD COLUMN cashier TEXT NOT NULL DEFAULT 'Register';
      ALTER TABLE refunds ADD COLUMN note TEXT NOT NULL DEFAULT '';
      CREATE INDEX idx_credit_payments_date ON credit_payments(business_date);
      CREATE INDEX idx_refunds_created ON refunds(created_at);
    `,
  },
];

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function all<T = Row>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(
  db: DatabaseSync,
  sql: string,
  ...params: SqlParam[]
): { changes: number; lastInsertRowid: number } {
  const result = db.prepare(sql).run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function nextCounter(db: DatabaseSync, key: string): number {
  const row = db
    .prepare(
      'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value',
    )
    .get(key) as { value: number } | undefined;
  if (!row) throw new Error(`Failed to allocate counter ${key}`);
  return Number(row.value);
}

function maxNumericSuffix(values: string[], prefix: string): number {
  let max = 0;
  for (const value of values) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function syncCounters(db: DatabaseSync): void {
  const receipts = (db.prepare('SELECT receipt_no FROM sales').all() as Array<{ receipt_no: string }>).map(
    (row) => row.receipt_no,
  );
  const refunds = (db.prepare('SELECT refund_no FROM refunds').all() as Array<{ refund_no: string }>).map(
    (row) => row.refund_no,
  );
  const upsert = db.prepare(
    'INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)',
  );
  upsert.run('receipt', maxNumericSuffix(receipts, 'WC'));
  upsert.run('refund', maxNumericSuffix(refunds, 'RF'));
}

export interface SettingsRow {
  id: number;
  store_name: string;
  logo_url: string;
  currency: string;
  mpesa_till_number: string;
  auto_dynamic_enabled: number;
  theme: 'light' | 'dark';
  receipt_footer: string;
  pin_hash: string;
  pin_is_default: number;
  updated_at: string;
}

export function ensureSettings(db: DatabaseSync): SettingsRow {
  const existing = get<SettingsRow>(db, 'SELECT * FROM settings WHERE id = 1');
  if (existing) return existing;

  run(
    db,
    `INSERT INTO settings (
      id, store_name, logo_url, currency, mpesa_till_number, auto_dynamic_enabled,
      theme, receipt_footer, pin_hash, pin_is_default, updated_at
    ) VALUES (1, ?, '', 'Ksh', '', 0, 'light', ?, ?, 1, ?)`,
    'Whispers Cosmetics',
    'Thank you for shopping with us.',
    hashPin('1234'),
    new Date().toISOString(),
  );
  return get<SettingsRow>(db, 'SELECT * FROM settings WHERE id = 1') as SettingsRow;
}

export function createBackup(db: DatabaseSync, dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(dir, `whispers-${stamp}.db`);
  if (fs.existsSync(target)) return target;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbPath, target);

  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .sort()
    .reverse();
  for (const stale of backups.slice(14)) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      // ignore cleanup errors
    }
  }
  return target;
}

export function checkpoint(db: DatabaseSync): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}
