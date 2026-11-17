import type { DatabaseSync } from 'node:sqlite';
import type { Product, ProductCategory, StockMovement, StockMovementReason } from '../../src/types';
import { PRODUCT_CATEGORIES } from '../../src/types';
import { all, get, newId, run, withTransaction } from '../db';
import { HttpError } from '../errors';
import { fromCents, toCents } from '../money';
import { businessDateFor, nowIso, todayFor } from '../time';
import { logAudit } from '../audit';
import {
  optionalBoolean,
  optionalString,
  oneOf,
  requiredInt,
  requiredString,
} from '../validation';
import { sanitizeImageUrl } from './images';

interface ProductRow {
  id: string;
  name: string;
  brand: string;
  sku: string;
  barcode: string;
  category: string;
  cost_price_cents: number;
  base_price_cents: number;
  current_price_cents: number;
  auto_dynamic: number;
  stock: number;
  reorder_level: number;
  is_perishable: number;
  expiry_date: string | null;
  image_url: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category as ProductCategory,
    costPrice: fromCents(row.cost_price_cents),
    basePrice: fromCents(row.base_price_cents),
    currentPrice: fromCents(row.current_price_cents),
    autoDynamicPricing: row.auto_dynamic === 1,
    stock: row.stock,
    reorderLevel: row.reorder_level,
    isPerishable: row.is_perishable === 1,
    expiryDate: row.expiry_date,
    imageUrl: row.image_url,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findRow(db: DatabaseSync, id: string): ProductRow {
  const row = get<ProductRow>(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Product not found.');
  return row;
}

export function getProduct(db: DatabaseSync, id: string): Product {
  return mapProduct(findRow(db, id));
}

export function listProducts(db: DatabaseSync): Product[] {
  return all<ProductRow>(db, 'SELECT * FROM products ORDER BY created_at DESC, name ASC').map(mapProduct);
}

function ean13FromSeed(seed: number): string {
  const base = `616400${String(seed).padStart(6, '0')}`.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${base}${(10 - (sum % 10)) % 10}`;
}

function generateBarcode(db: DatabaseSync): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const seed = Math.floor(100000 + Math.random() * 899999);
    const code = ean13FromSeed(seed);
    const exists = get(db, 'SELECT 1 FROM products WHERE barcode = ?', code);
    if (!exists) return code;
  }
  throw new HttpError(500, 'Could not generate a unique barcode.');
}

function normalizeBarcode(value: unknown, db: DatabaseSync, excludeId?: string): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    return generateBarcode(db);
  }
  const digits = String(value).replace(/\s+/g, '');
  if (!/^\d{6,14}$/.test(digits)) {
    throw new HttpError(400, 'Barcode must be 6 to 14 digits.');
  }
  const existing = get<{ id: string }>(db, 'SELECT id FROM products WHERE barcode = ?', digits);
  if (existing && existing.id !== excludeId) {
    throw new HttpError(409, 'Another product already uses this barcode.');
  }
  return digits;
}

function generateSku(db: DatabaseSync, category: ProductCategory): string {
  const prefix = category.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'WC';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `WC-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!get(db, 'SELECT 1 FROM products WHERE sku = ?', candidate)) return candidate;
  }
  throw new HttpError(500, 'Could not generate a unique SKU.');
}

function normalizeSku(
  value: unknown,
  db: DatabaseSync,
  category: ProductCategory,
  excludeId?: string,
): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    return generateSku(db, category);
  }
  const sku = String(value).trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(sku)) {
    throw new HttpError(400, 'SKU may contain letters, numbers, dots, dashes and underscores (2-40 characters).');
  }
  const existing = get<{ id: string }>(db, 'SELECT id FROM products WHERE sku = ?', sku);
  if (existing && existing.id !== excludeId) {
    throw new HttpError(409, 'Another product already uses this SKU.');
  }
  return sku;
}

function normalizeCategory(value: unknown): ProductCategory {
  return oneOf(value, PRODUCT_CATEGORIES, 'Category');
}

function normalizeExpiry(value: unknown, perishable: boolean): string | null {
  if (!perishable) return null;
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, 'Expiry date must be a valid date (YYYY-MM-DD).');
  }
  return text;
}

function movementReason(value: string): StockMovementReason {
  const allowed: StockMovementReason[] = ['opening', 'sale', 'refund', 'restock', 'adjustment', 'credit'];
  return allowed.includes(value as StockMovementReason)
    ? (value as StockMovementReason)
    : 'adjustment';
}

export function createProduct(
  db: DatabaseSync,
  body: Record<string, unknown>,
  timezone: string,
  ip: string,
): Product {
  const name = requiredString(body.name, 'Product name', { max: 120 });
  const category = normalizeCategory(body.category ?? 'Lotion');
  const brand = optionalString(body.brand, 'Brand', { max: 80 });
  const costPrice = toCents(body.costPrice ?? 0, 'Cost price');
  const basePrice = toCents(body.basePrice ?? body.currentPrice ?? 0, 'Base price');
  const currentPrice = toCents(body.currentPrice ?? basePrice / 100, 'Selling price');
  const autoDynamic = optionalBoolean(body.autoDynamicPricing, true);
  const stock = requiredInt(body.stock ?? 0, 'Stock', { min: 0, max: 1_000_000 });
  const reorderLevel = requiredInt(body.reorderLevel ?? 0, 'Reorder level', { min: 0, max: 1_000_000 });
  const isPerishable = optionalBoolean(body.isPerishable, false);
  const expiryDate = normalizeExpiry(body.expiryDate, isPerishable);
  const imageUrl = sanitizeImageUrl(body.imageUrl);

  if (imageUrl === '' && typeof body.imageUrl === 'string' && body.imageUrl.trim() !== '') {
    throw new HttpError(400, 'Image URL is not allowed.');
  }

  return withTransaction(db, () => {
    const id = newId('prod');
    const sku = normalizeSku(body.sku, db, category);
    const barcode = normalizeBarcode(body.barcode, db);
    const now = nowIso();

    run(
      db,
      `INSERT INTO products (
        id, name, brand, sku, barcode, category, cost_price_cents, base_price_cents,
        current_price_cents, auto_dynamic, stock, reorder_level, is_perishable,
        expiry_date, image_url, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      name,
      brand,
      sku,
      barcode,
      category,
      costPrice,
      basePrice,
      currentPrice,
      autoDynamic ? 1 : 0,
      stock,
      reorderLevel,
      isPerishable ? 1 : 0,
      expiryDate,
      imageUrl,
      now,
      now,
    );

    if (stock > 0) {
      recordStockMovement(db, {
        productId: id,
        delta: stock,
        reason: 'opening',
        note: 'Opening stock',
        businessDate: todayFor(timezone),
        createdAt: now,
      });
    }

    logAudit(db, {
      action: 'product.create',
      entityType: 'product',
      entityId: id,
      details: { name, sku, barcode, stock, category },
      ip,
    });

    return getProduct(db, id);
  });
}

export function updateProduct(
  db: DatabaseSync,
  id: string,
  body: Record<string, unknown>,
  timezone: string,
  ip: string,
): Product {
  const existing = findRow(db, id);

  return withTransaction(db, () => {
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const category = has('category') ? normalizeCategory(body.category) : (existing.category as ProductCategory);
    const name = has('name')
      ? requiredString(body.name, 'Product name', { max: 120 })
      : existing.name;
    const brand = has('brand') ? optionalString(body.brand, 'Brand', { max: 80 }) : existing.brand;
    const costPrice = has('costPrice')
      ? toCents(body.costPrice, 'Cost price')
      : existing.cost_price_cents;
    const basePrice = has('basePrice')
      ? toCents(body.basePrice, 'Base price')
      : existing.base_price_cents;
    const currentPrice = has('currentPrice')
      ? toCents(body.currentPrice, 'Selling price')
      : existing.current_price_cents;
    const autoDynamic = has('autoDynamicPricing')
      ? optionalBoolean(body.autoDynamicPricing, existing.auto_dynamic === 1)
      : existing.auto_dynamic === 1;
    const isPerishable = has('isPerishable')
      ? optionalBoolean(body.isPerishable, existing.is_perishable === 1)
      : existing.is_perishable === 1;
    const expiryDate = has('expiryDate') || has('isPerishable')
      ? normalizeExpiry(body.expiryDate ?? existing.expiry_date, isPerishable)
      : existing.expiry_date;
    const reorderLevel = has('reorderLevel')
      ? requiredInt(body.reorderLevel, 'Reorder level', { min: 0, max: 1_000_000 })
      : existing.reorder_level;
    const imageUrl = has('imageUrl') ? sanitizeImageUrl(body.imageUrl) : existing.image_url;
    if (has('imageUrl') && imageUrl === '' && String(body.imageUrl ?? '').trim() !== '') {
      throw new HttpError(400, 'Image URL is not allowed.');
    }
    const sku = has('sku') ? normalizeSku(body.sku, db, category, id) : existing.sku;
    const barcode = has('barcode')
      ? normalizeBarcode(body.barcode, db, id)
      : existing.barcode;

    const stock = has('stock')
      ? requiredInt(body.stock, 'Stock', { min: 0, max: 1_000_000 })
      : existing.stock;
    const stockDelta = stock - existing.stock;
    const now = nowIso();

    run(
      db,
      `UPDATE products SET name = ?, brand = ?, sku = ?, barcode = ?, category = ?,
        cost_price_cents = ?, base_price_cents = ?, current_price_cents = ?, auto_dynamic = ?,
        stock = ?, reorder_level = ?, is_perishable = ?, expiry_date = ?, image_url = ?, updated_at = ?
       WHERE id = ?`,
      name,
      brand,
      sku,
      barcode,
      category,
      costPrice,
      basePrice,
      currentPrice,
      autoDynamic ? 1 : 0,
      stock,
      reorderLevel,
      isPerishable ? 1 : 0,
      expiryDate,
      imageUrl,
      now,
      id,
    );

    if (stockDelta !== 0) {
      recordStockMovement(db, {
        productId: id,
        delta: stockDelta,
        reason: 'adjustment',
        note:
          optionalString(body.stockNote, 'Stock note', { max: 200 }) ||
          'Stock quantity edited on product form',
        businessDate: todayFor(timezone),
        createdAt: now,
      });
    }

    logAudit(db, {
      action: 'product.update',
      entityType: 'product',
      entityId: id,
      details: {
        name,
        sku,
        category,
        stock,
        stockDelta,
        prices: {
          cost: fromCents(costPrice),
          base: fromCents(basePrice),
          current: fromCents(currentPrice),
        },
        archived: existing.archived === 1,
      },
      ip,
    });

    return getProduct(db, id);
  });
}

export function setProductArchived(
  db: DatabaseSync,
  id: string,
  archived: boolean,
  ip: string,
): Product {
  findRow(db, id);
  run(db, 'UPDATE products SET archived = ?, updated_at = ? WHERE id = ?', archived ? 1 : 0, nowIso(), id);
  logAudit(db, {
    action: archived ? 'product.archive' : 'product.restore',
    entityType: 'product',
    entityId: id,
    ip,
  });
  return getProduct(db, id);
}

export function restockProduct(
  db: DatabaseSync,
  id: string,
  body: Record<string, unknown>,
  timezone: string,
  ip: string,
): { product: Product; movement: StockMovement } {
  const quantity = requiredInt(body.quantity, 'Restock quantity', { min: 1, max: 1_000_000 });
  const note = optionalString(body.note, 'Restock note', { max: 200 });
  const hasUnitCost = body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== '';
  const unitCost = hasUnitCost ? toCents(body.unitCost, 'Unit cost') : null;

  const product = findRow(db, id);

  return withTransaction(db, () => {
    const now = nowIso();
    run(
      db,
      'UPDATE products SET stock = stock + ?, cost_price_cents = ?, updated_at = ? WHERE id = ?',
      quantity,
      unitCost ?? product.cost_price_cents,
      now,
      id,
    );
    const movement = recordStockMovement(db, {
      productId: id,
      delta: quantity,
      reason: 'restock',
      note: note || `Restocked ${quantity} unit(s)`,
      businessDate: todayFor(timezone),
      createdAt: now,
    });
    logAudit(db, {
      action: 'product.restock',
      entityType: 'product',
      entityId: id,
      details: {
        quantity,
        unitCost: unitCost === null ? null : fromCents(unitCost),
        note,
      },
      ip,
    });
    return { product: getProduct(db, id), movement };
  });
}

export function adjustStockCount(
  db: DatabaseSync,
  id: string,
  body: Record<string, unknown>,
  timezone: string,
  ip: string,
): { product: Product; movement: StockMovement } {
  const counted = requiredInt(body.countedStock, 'Counted stock', { min: 0, max: 1_000_000 });
  const note = optionalString(body.note, 'Adjustment note', { max: 200 }) || 'Physical stock count';
  const product = findRow(db, id);
  const delta = counted - product.stock;
  if (delta === 0) throw new HttpError(400, 'Counted stock matches the current stock.');

  return withTransaction(db, () => {
    const now = nowIso();
    run(db, 'UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', counted, now, id);
    const movement = recordStockMovement(db, {
      productId: id,
      delta,
      reason: 'adjustment',
      note,
      businessDate: todayFor(timezone),
      createdAt: now,
    });
    logAudit(db, {
      action: 'product.stock_adjust',
      entityType: 'product',
      entityId: id,
      details: { from: product.stock, to: counted, delta, note },
      ip,
    });
    return { product: getProduct(db, id), movement };
  });
}

export function recordStockMovement(
  db: DatabaseSync,
  payload: {
    productId: string;
    delta: number;
    reason: StockMovementReason;
    referenceId?: string | null;
    note?: string;
    businessDate: string;
    createdAt?: string;
  },
): StockMovement {
  const id = newId('mv');
  const createdAt = payload.createdAt ?? nowIso();
  run(
    db,
    `INSERT INTO stock_movements (id, product_id, delta, reason, reference_id, note, business_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    payload.productId,
    payload.delta,
    movementReason(payload.reason),
    payload.referenceId ?? null,
    payload.note ?? '',
    payload.businessDate,
    createdAt,
  );
  const name = get<{ name: string }>(db, 'SELECT name FROM products WHERE id = ?', payload.productId);
  return {
    id,
    productId: payload.productId,
    productName: name?.name ?? payload.productId,
    delta: payload.delta,
    reason: payload.reason,
    referenceId: payload.referenceId ?? undefined,
    note: payload.note,
    businessDate: payload.businessDate,
    createdAt,
  };
}

interface MovementRow {
  id: string;
  product_id: string;
  product_name: string;
  delta: number;
  reason: string;
  reference_id: string | null;
  note: string;
  business_date: string;
  created_at: string;
}

export function listStockMovements(db: DatabaseSync, productId: string, limit = 100): StockMovement[] {
  findRow(db, productId);
  return all<MovementRow>(
    db,
    `SELECT m.*, p.name AS product_name FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    productId,
    Math.min(500, Math.max(1, limit)),
  ).map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    delta: row.delta,
    reason: movementReason(row.reason),
    referenceId: row.reference_id ?? undefined,
    note: row.note || undefined,
    businessDate: row.business_date,
    createdAt: row.created_at,
  }));
}

export function recentMovements(db: DatabaseSync, limit = 50): StockMovement[] {
  return all<MovementRow>(
    db,
    `SELECT m.*, p.name AS product_name FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     ORDER BY m.created_at DESC LIMIT ?`,
    Math.min(200, Math.max(1, limit)),
  ).map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    delta: row.delta,
    reason: movementReason(row.reason),
    referenceId: row.reference_id ?? undefined,
    note: row.note || undefined,
    businessDate: row.business_date,
    createdAt: row.created_at,
  }));
}

export function productBusinessDate(timezone: string): string {
  return businessDateFor(new Date(), timezone);
}
