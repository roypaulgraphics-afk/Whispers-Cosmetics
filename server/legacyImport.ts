import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../src/types';
import { run, withTransaction } from './db';
import { hashPin } from './password';
import { businessDateFor, nowIso } from './time';

interface LegacyProduct {
  id?: string;
  name?: string;
  brand?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  costPrice?: number;
  basePrice?: number;
  currentPrice?: number;
  autoDynamicPricing?: boolean;
  stock?: number;
  reorderLevel?: number;
  isPerishable?: boolean;
  expiryDate?: string | null;
  imageUrl?: string;
  updatedAt?: string;
}

interface LegacyItem {
  productId?: string;
  productName?: string;
  category?: string;
  quantity?: number;
  unitPrice?: number;
  costPrice?: number;
}

interface LegacyMpesa {
  transactionCode?: string;
  senderName?: string;
  senderPhone?: string;
  amountReceived?: number;
  rawMessage?: string;
  verified?: boolean;
  timestamp?: string;
}

interface LegacySale {
  id?: string;
  receiptNo?: string;
  items?: LegacyItem[];
  totalAmount?: number;
  paymentMode?: string;
  mpesaDetails?: LegacyMpesa;
  creditRecordId?: string;
  createdAt?: string;
}

interface LegacyPayment {
  id?: string;
  amount?: number;
  method?: string;
  mpesaDetails?: LegacyMpesa;
  paidAt?: string;
  note?: string;
}

interface LegacyCredit {
  id?: string;
  creditorName?: string;
  creditorPhone?: string;
  pendingDate?: string;
  dueDate?: string;
  items?: LegacyItem[];
  totalAmount?: number;
  amountPaid?: number;
  notes?: string;
  payments?: LegacyPayment[];
  createdAt?: string;
  updatedAt?: string;
}

interface LegacySettings {
  storeName?: string;
  logoUrl?: string;
  pin?: string;
  currency?: string;
  mpesaTillNumber?: string;
  autoDynamicEnabled?: boolean;
  theme?: 'light' | 'dark';
}

interface LegacyDatabase {
  products?: LegacyProduct[];
  transactions?: LegacySale[];
  credits?: LegacyCredit[];
  settings?: LegacySettings;
}

function asCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function asInt(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function asIso(value: unknown): string {
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return nowIso();
}

function categoryOf(value: unknown): ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory)
    ? (value as ProductCategory)
    : 'Lotion';
}

function ean13(seed: number): string {
  const base = `616400${String(seed).padStart(6, '0')}`.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base}${check}`;
}

function imageOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('preset:')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('data:image/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

/**
 * Imports the AI Studio JSON store into the SQLite schema on first run.
 * Historical sales are preserved for reporting; opening stock is recorded as
 * the current stock because the legacy file has no movement ledger.
 */
export function importLegacyDatabase(
  db: DatabaseSync,
  jsonPath: string,
  timezone: string,
): { products: number; sales: number; credits: number } {
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const legacy = JSON.parse(raw) as LegacyDatabase;

  const backupDir = path.join(path.dirname(jsonPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(jsonPath, path.join(backupDir, `legacy-json-${stamp}.json`));

  return withTransaction(db, () => {
    const now = nowIso();
    let productCount = 0;
    let saleCount = 0;
    let creditCount = 0;

    const usedSku = new Set<string>();
    const usedBarcode = new Set<string>();
    const usedProductIds = new Set<string>();

    for (const [index, product] of (legacy.products ?? []).entries()) {
      const name = String(product.name ?? '').trim() || `Imported product ${index + 1}`;
      let id = String(product.id ?? '').trim() || `prod-${randomUUID()}`;
      if (usedProductIds.has(id)) id = `prod-${randomUUID()}`;
      usedProductIds.add(id);

      let sku = String(product.sku ?? '').trim();
      if (!sku) sku = `WC-${categoryOf(product.category).slice(0, 3).toUpperCase()}-${100 + index}`;
      if (usedSku.has(sku.toLowerCase())) sku = `${sku}-${index + 2}`;
      usedSku.add(sku.toLowerCase());

      let barcode = String(product.barcode ?? '').replace(/\D/g, '');
      if (!barcode || usedBarcode.has(barcode)) {
        let n = index + 1;
        while (usedBarcode.has(ean13(n))) n += 1;
        barcode = ean13(n);
      }
      usedBarcode.add(barcode);

      const stock = asInt(product.stock);
      run(
        db,
        `INSERT INTO products (
          id, name, brand, sku, barcode, category, cost_price_cents, base_price_cents,
          current_price_cents, auto_dynamic, stock, reorder_level, is_perishable,
          expiry_date, image_url, archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        id,
        name,
        String(product.brand ?? '').trim(),
        sku,
        barcode,
        categoryOf(product.category),
        asCents(product.costPrice),
        asCents(product.basePrice),
        asCents(product.currentPrice ?? product.basePrice),
        product.autoDynamicPricing === false ? 0 : 1,
        stock,
        asInt(product.reorderLevel),
        product.isPerishable ? 1 : 0,
        product.isPerishable && product.expiryDate ? String(product.expiryDate).slice(0, 10) : null,
        imageOf(product.imageUrl),
        asIso(product.updatedAt),
        asIso(product.updatedAt),
      );
      if (stock > 0) {
        run(
          db,
          `INSERT INTO stock_movements (id, product_id, delta, reason, reference_id, note, business_date, created_at)
           VALUES (?, ?, ?, 'opening', NULL, ?, ?, ?)`,
          `mv-${randomUUID()}`,
          id,
          stock,
          'Opening stock imported from legacy register',
          businessDateFor(now, timezone),
          now,
        );
      }
      productCount += 1;
    }

    const legacySettings = legacy.settings;
    if (legacySettings) {
      const pin = typeof legacySettings.pin === 'string' && /^\d{4}$/.test(legacySettings.pin)
        ? legacySettings.pin
        : '1234';
      run(
        db,
        `UPDATE settings SET store_name = ?, logo_url = ?, currency = ?, mpesa_till_number = ?,
          auto_dynamic_enabled = ?, theme = ?, pin_hash = ?, pin_is_default = ?, updated_at = ?
         WHERE id = 1`,
        String(legacySettings.storeName ?? 'Whispers Cosmetics').slice(0, 80),
        imageOf(legacySettings.logoUrl),
        String(legacySettings.currency ?? 'Ksh').slice(0, 8),
        String(legacySettings.mpesaTillNumber ?? '').slice(0, 20),
        legacySettings.autoDynamicEnabled ? 1 : 0,
        legacySettings.theme === 'dark' ? 'dark' : 'light',
        hashPin(pin),
        pin === '1234' ? 1 : 0,
        now,
      );
    }

    const creditIds = new Set<string>();
    for (const [index, credit] of (legacy.credits ?? []).entries()) {
      let id = String(credit.id ?? '').trim() || `cred-${randomUUID()}`;
      if (creditIds.has(id)) id = `cred-${randomUUID()}`;
      creditIds.add(id);

      const total = asCents(credit.totalAmount);
      const paid = Math.min(total, asCents(credit.amountPaid));
      const createdAt = asIso(credit.createdAt);
      const pendingDate =
        typeof credit.pendingDate === 'string' && credit.pendingDate
          ? credit.pendingDate.slice(0, 10)
          : businessDateFor(createdAt, timezone);
      const dueDate =
        typeof credit.dueDate === 'string' && credit.dueDate
          ? credit.dueDate.slice(0, 10)
          : pendingDate;

      run(
        db,
        `INSERT INTO credits (
          id, creditor_name, creditor_phone, pending_date, due_date, items_json,
          total_cents, amount_paid_cents, notes, sale_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        id,
        String(credit.creditorName ?? 'Imported creditor').trim().slice(0, 120),
        String(credit.creditorPhone ?? '').trim().slice(0, 30),
        pendingDate,
        dueDate,
        JSON.stringify(
          (credit.items ?? []).map((item) => ({
            productId: String(item.productId ?? ''),
            productName: String(item.productName ?? ''),
            category: categoryOf(item.category),
            quantity: Math.max(1, asInt(item.quantity)),
            unitPrice: asCents(item.unitPrice) / 100,
            costPrice: asCents(item.costPrice) / 100,
          })),
        ),
        total,
        paid,
        String(credit.notes ?? '').trim().slice(0, 500),
        createdAt,
        asIso(credit.updatedAt),
      );

      for (const payment of credit.payments ?? []) {
        const amount = asCents(payment.amount);
        if (amount <= 0) continue;
        let code = String(payment.mpesaDetails?.transactionCode ?? '').trim().toUpperCase() || null;
        if (code) {
          const exists = db
            .prepare('SELECT 1 FROM credit_payments WHERE mpesa_code = ?')
            .get(code);
          if (exists) code = null;
        }
        run(
          db,
          `INSERT INTO credit_payments (
            id, credit_id, amount_cents, method, mpesa_code, mpesa_phone,
            mpesa_sender_name, mpesa_raw_message, note, paid_at, business_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `cp-${randomUUID()}`,
          id,
          amount,
          payment.method === 'Mpesa' ? 'Mpesa' : 'Cash',
          code,
          String(payment.mpesaDetails?.senderPhone ?? ''),
          String(payment.mpesaDetails?.senderName ?? ''),
          String(payment.mpesaDetails?.rawMessage ?? ''),
          String(payment.note ?? ''),
          asIso(payment.paidAt),
          businessDateFor(asIso(payment.paidAt), timezone),
        );
      }
      creditCount += 1;
    }

    const usedReceipts = new Set<string>();
    const usedSaleIds = new Set<string>();
    for (const [index, sale] of (legacy.transactions ?? []).entries()) {
      let id = String(sale.id ?? '').trim() || `sale-${randomUUID()}`;
      if (usedSaleIds.has(id)) id = `sale-${randomUUID()}`;
      usedSaleIds.add(id);

      let receipt = String(sale.receiptNo ?? '').trim();
      if (!receipt || usedReceipts.has(receipt)) receipt = `WC-LEGACY-${index + 1}`;
      usedReceipts.add(receipt);

      const total = asCents(sale.totalAmount);
      const createdAt = asIso(sale.createdAt);
      const paymentMode =
        sale.paymentMode === 'Mpesa' || sale.paymentMode === 'Credit' ? sale.paymentMode : 'Cash';
      const creditId =
        sale.creditRecordId && creditIds.has(String(sale.creditRecordId))
          ? String(sale.creditRecordId)
          : null;
      const mpesa = sale.mpesaDetails;

      run(
        db,
        `INSERT INTO sales (
          id, receipt_no, subtotal_cents, discount_cents, total_cents, payment_mode,
          mpesa_code, mpesa_phone, mpesa_sender_name, mpesa_raw_message, mpesa_intent_id,
          credit_id, cash_tendered_cents, change_cents, status, cashier, note,
          created_at, business_date
        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'Completed', 'Imported register', '', ?, ?)`,
        id,
        receipt,
        total,
        total,
        paymentMode,
        mpesa?.transactionCode ? String(mpesa.transactionCode).toUpperCase() : null,
        mpesa?.senderPhone ? String(mpesa.senderPhone) : null,
        mpesa?.senderName ? String(mpesa.senderName) : null,
        mpesa?.rawMessage ? String(mpesa.rawMessage) : null,
        creditId,
        createdAt,
        businessDateFor(createdAt, timezone),
      );

      for (const item of sale.items ?? []) {
        const quantity = Math.max(1, asInt(item.quantity));
        run(
          db,
          `INSERT INTO sale_items (
            id, sale_id, product_id, product_name, category, quantity,
            unit_price_cents, cost_price_cents, refunded_quantity
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          `si-${randomUUID()}`,
          id,
          String(item.productId ?? ''),
          String(item.productName ?? 'Imported item'),
          categoryOf(item.category),
          quantity,
          asCents(item.unitPrice),
          asCents(item.costPrice),
        );
      }
      saleCount += 1;
    }

    run(
      db,
      `INSERT INTO audit_log (action, entity_type, entity_id, details_json, ip, created_at)
       VALUES ('legacy.import', 'database', 'legacy-json', ?, '', ?)`,
      JSON.stringify({ products: productCount, credits: creditCount, sales: saleCount }),
      now,
    );

    return { products: productCount, sales: saleCount, credits: creditCount };
  });
}
