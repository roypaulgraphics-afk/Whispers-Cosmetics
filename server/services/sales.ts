import type { DatabaseSync } from 'node:sqlite';
import type {
  MpesaDetails,
  PaymentMode,
  ProductCategory,
  RefundItem,
  RefundRecord,
  SaleItem,
  SaleTransaction,
} from '../../src/types';
import type { AppConfig } from '../config';
import { all, get, newId, nextCounter, run, withTransaction } from '../db';
import { HttpError } from '../errors';
import { fromCents, toCents } from '../money';
import { nowIso, todayFor } from '../time';
import { logAudit } from '../audit';
import {
  optionalBoolean,
  optionalString,
  oneOf,
  requireObject,
  requiredInt,
  requiredString,
} from '../validation';
import { recordStockMovement } from './products';
import {
  markIntentUsed,
  validateMpesaPayment,
  type ValidatedMpesa,
} from './mpesaPayments';
import { applyRefundToCredit, createSaleCredit, type CreditInput } from './credits';
import { computeRefundAllocation } from '../../src/lib/refunds';

interface SaleProductRow {
  id: string;
  name: string;
  category: string;
  cost_price_cents: number;
  current_price_cents: number;
  stock: number;
  archived: number;
}

interface SaleRow {
  id: string;
  receipt_no: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  payment_mode: PaymentMode;
  mpesa_code: string | null;
  mpesa_phone: string | null;
  mpesa_sender_name: string | null;
  mpesa_raw_message: string | null;
  mpesa_intent_id: string | null;
  credit_id: string | null;
  cash_tendered_cents: number | null;
  change_cents: number | null;
  status: 'Completed' | 'Partially Refunded' | 'Refunded';
  cashier: string;
  note: string;
  created_at: string;
  business_date: string;
}

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  category: string;
  quantity: number;
  unit_price_cents: number;
  cost_price_cents: number;
  refunded_quantity: number;
}

interface RefundRow {
  id: string;
  refund_no: string;
  sale_id: string;
  total_cents: number;
  method: 'Cash' | 'Mpesa';
  reason: string;
  restocked: number;
  cashier: string;
  note: string;
  business_date: string;
  created_at: string;
}

interface RefundItemRow {
  id: string;
  refund_id: string;
  sale_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  restock: number;
}

function mapSaleItem(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category as ProductCategory,
    quantity: row.quantity,
    unitPrice: fromCents(row.unit_price_cents),
    costPrice: fromCents(row.cost_price_cents),
    refundedQuantity: row.refunded_quantity,
  };
}

function mapRefundItems(db: DatabaseSync, refundId: string): RefundItem[] {
  return all<RefundItemRow>(
    db,
    `SELECT ri.*, p.name AS product_name FROM refund_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     WHERE ri.refund_id = ? ORDER BY ri.rowid ASC`,
    refundId,
  ).map((row) => ({
    id: row.id,
    saleItemId: row.sale_item_id,
    productId: row.product_id,
    productName: row.product_name ?? row.product_id,
    quantity: row.quantity,
    unitPrice: fromCents(row.unit_price_cents),
    restock: row.restock === 1,
  }));
}

function mapRefund(db: DatabaseSync, row: RefundRow, saleReceiptNo: string): RefundRecord {
  return {
    id: row.id,
    refundNo: row.refund_no,
    saleId: row.sale_id,
    saleReceiptNo,
    items: mapRefundItems(db, row.id),
    totalAmount: fromCents(row.total_cents),
    method: row.method,
    reason: row.reason,
    restocked: row.restocked === 1,
    cashier: row.cashier,
    note: row.note || undefined,
    businessDate: row.business_date,
    createdAt: row.created_at,
  };
}

function mpesaDetailsFor(row: SaleRow): MpesaDetails | undefined {
  if (row.payment_mode !== 'Mpesa') return undefined;
  return {
    transactionCode: row.mpesa_code ?? '',
    senderName: row.mpesa_sender_name ?? '',
    senderPhone: row.mpesa_phone ?? '',
    amountReceived: fromCents(row.total_cents),
    rawMessage: row.mpesa_raw_message ?? '',
    verified: true,
    timestamp: row.created_at,
    mode: row.mpesa_intent_id ? 'stk' : 'manual',
    intentId: row.mpesa_intent_id ?? undefined,
  };
}

export function getSale(db: DatabaseSync, saleId: string): SaleTransaction {
  const row = get<SaleRow>(db, 'SELECT * FROM sales WHERE id = ?', saleId);
  if (!row) throw new HttpError(404, 'Sale not found.');
  const items = all<SaleItemRow>(
    db,
    'SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid ASC',
    saleId,
  ).map(mapSaleItem);
  const refunds = all<RefundRow>(
    db,
    'SELECT * FROM refunds WHERE sale_id = ? ORDER BY created_at ASC',
    saleId,
  ).map((refund) => mapRefund(db, refund, row.receipt_no));

  return {
    id: row.id,
    receiptNo: row.receipt_no,
    items,
    subtotalAmount: fromCents(row.subtotal_cents),
    discountAmount: fromCents(row.discount_cents),
    totalAmount: fromCents(row.total_cents),
    paymentMode: row.payment_mode,
    mpesaDetails: mpesaDetailsFor(row),
    creditRecordId: row.credit_id ?? undefined,
    cashTendered: row.cash_tendered_cents === null ? undefined : fromCents(row.cash_tendered_cents),
    changeGiven: row.change_cents === null ? undefined : fromCents(row.change_cents),
    status: row.status,
    businessDate: row.business_date,
    cashier: row.cashier,
    note: row.note || undefined,
    refunds,
    createdAt: row.created_at,
  };
}

export interface SaleListOptions {
  from?: string;
  to?: string;
  mode?: PaymentMode;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listSales(
  db: DatabaseSync,
  options: SaleListOptions = {},
): { sales: SaleTransaction[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.from) {
    where.push('s.business_date >= ?');
    params.push(options.from);
  }
  if (options.to) {
    where.push('s.business_date <= ?');
    params.push(options.to);
  }
  if (options.mode) {
    where.push('s.payment_mode = ?');
    params.push(options.mode);
  }
  if (options.status) {
    where.push('s.status = ?');
    params.push(options.status);
  }
  if (options.search) {
    const term = `%${options.search}%`;
    where.push(`(
      s.receipt_no LIKE ? OR s.cashier LIKE ? OR s.note LIKE ? OR IFNULL(s.mpesa_code, '') LIKE ?
      OR EXISTS (SELECT 1 FROM credits c WHERE c.sale_id = s.id AND c.creditor_name LIKE ?)
    )`);
    params.push(term, term, term, term, term);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const countRow = get<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM sales s ${clause}`,
    ...params,
  );
  const rows = all<SaleRow>(
    db,
    `SELECT s.* FROM sales s ${clause} ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return {
    sales: rows.map((row) => getSale(db, row.id)),
    total: Number(countRow?.count ?? 0),
  };
}

function parseSaleLines(value: unknown): Array<{ productId: string; quantity: number }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'Add at least one product to the sale.');
  }
  if (value.length > 100) throw new HttpError(400, 'Too many sale lines.');
  const quantities = new Map<string, number>();
  for (const entry of value) {
    const item = requireObject(entry, 'Sale item');
    const productId = requiredString(item.productId, 'Product', { max: 80 });
    const quantity = requiredInt(item.quantity, 'Quantity', { min: 1, max: 100_000 });
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export interface SaleContext {
  config: AppConfig;
  cashier: string;
  ip: string;
}

export function createSale(
  db: DatabaseSync,
  body: Record<string, unknown>,
  context: SaleContext,
): { sale: SaleTransaction; credit?: ReturnType<typeof createSaleCredit>['credit']; deposit?: ReturnType<typeof createSaleCredit>['deposit'] } {
  const lines = parseSaleLines(body.items);
  const paymentMode = oneOf(body.paymentMode, ['Cash', 'Mpesa', 'Credit'] as const, 'Payment mode');
  const note = optionalString(body.note, 'Sale note', { max: 300 });
  const hasDiscount =
    body.discountAmount !== undefined && body.discountAmount !== null && body.discountAmount !== '';
  const discountCents = hasDiscount ? toCents(body.discountAmount, 'Discount') : 0;

  let credit: ReturnType<typeof createSaleCredit>['credit'] | undefined;
  let deposit: ReturnType<typeof createSaleCredit>['deposit'] | undefined;

  const sale = withTransaction(db, () => {
    const placeholders = lines.map(() => '?').join(', ');
    const productRows = all<SaleProductRow>(
      db,
      `SELECT * FROM products WHERE id IN (${placeholders})`,
      ...lines.map((line) => line.productId),
    );
    const byId = new Map(productRows.map((row) => [row.id, row]));
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (!product) throw new HttpError(400, 'One of the products in this sale no longer exists.');
      if (product.archived === 1) {
        throw new HttpError(400, `${product.name} is archived and cannot be sold.`);
      }
      if (product.stock < line.quantity) {
        throw new HttpError(
          400,
          `${product.name} has only ${product.stock} unit(s) in stock (requested ${line.quantity}).`,
        );
      }
    }

    let subtotalCents = 0;
    for (const line of lines) {
      const product = byId.get(line.productId) as SaleProductRow;
      subtotalCents += product.current_price_cents * line.quantity;
    }
    if (discountCents > subtotalCents) {
      throw new HttpError(400, 'The discount cannot be more than the sale subtotal.');
    }
    const totalCents = subtotalCents - discountCents;
    if (totalCents <= 0 && paymentMode !== 'Cash') {
      throw new HttpError(400, 'A zero-value sale can only be recorded as a cash sale.');
    }

    let cashTenderedCents: number | null = null;
    let changeCents: number | null = null;
    let mpesa: ValidatedMpesa | null = null;
    if (paymentMode === 'Cash') {
      if (body.cashTendered === undefined || body.cashTendered === null || body.cashTendered === '') {
        cashTenderedCents = totalCents;
      } else {
        cashTenderedCents = toCents(body.cashTendered, 'Cash tendered');
        if (cashTenderedCents < totalCents) {
          throw new HttpError(400, 'Cash tendered is less than the sale total.');
        }
      }
      changeCents = cashTenderedCents - totalCents;
    } else if (paymentMode === 'Mpesa') {
      if (!body.mpesa) throw new HttpError(400, 'M-Pesa payment details are required.');
      mpesa = validateMpesaPayment(db, body.mpesa, totalCents, 'sale', context.config);
    }

    const now = nowIso();
    const businessDate = todayFor(context.config.timezone);
    const saleId = newId('sale');
    const receiptNo = `WC-${nextCounter(db, 'receipt')}`;

    run(
      db,
      `INSERT INTO sales (
        id, receipt_no, subtotal_cents, discount_cents, total_cents, payment_mode,
        mpesa_code, mpesa_phone, mpesa_sender_name, mpesa_raw_message, mpesa_intent_id,
        credit_id, cash_tendered_cents, change_cents, status, cashier, note, created_at, business_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'Completed', ?, ?, ?, ?)`,
      saleId,
      receiptNo,
      subtotalCents,
      discountCents,
      totalCents,
      paymentMode,
      mpesa?.code || null,
      mpesa?.phone || null,
      mpesa?.senderName || null,
      mpesa?.rawMessage || null,
      mpesa?.intentId ?? null,
      cashTenderedCents,
      changeCents,
      context.cashier,
      note,
      now,
      businessDate,
    );

    const saleItems: SaleItem[] = lines.map((line) => {
      const product = byId.get(line.productId) as SaleProductRow;
      const itemId = newId('si');
      run(
        db,
        `INSERT INTO sale_items (
          id, sale_id, product_id, product_name, category, quantity, unit_price_cents,
          cost_price_cents, refunded_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        itemId,
        saleId,
        product.id,
        product.name,
        product.category,
        line.quantity,
        product.current_price_cents,
        product.cost_price_cents,
      );
      const stockUpdate = run(
        db,
        'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?',
        line.quantity,
        now,
        product.id,
        line.quantity,
      );
      if (stockUpdate.changes !== 1) {
        throw new HttpError(409, `${product.name} stock changed. Review the cart and try again.`);
      }
      recordStockMovement(db, {
        productId: product.id,
        delta: -line.quantity,
        reason: paymentMode === 'Credit' ? 'credit' : 'sale',
        referenceId: saleId,
        note: `Sold on ${receiptNo}`,
        businessDate,
        createdAt: now,
      });
      return {
        id: itemId,
        productId: product.id,
        productName: product.name,
        category: product.category as ProductCategory,
        quantity: line.quantity,
        unitPrice: fromCents(product.current_price_cents),
        costPrice: fromCents(product.cost_price_cents),
        refundedQuantity: 0,
      };
    });

    if (mpesa?.intentId) {
      markIntentUsed(db, mpesa.intentId, 'sale', saleId);
    }

    if (paymentMode === 'Credit') {
      if (!body.credit) throw new HttpError(400, 'Customer credit details are required.');
      const result = createSaleCredit(db, body.credit as CreditInput, {
        saleId,
        totalCents,
        items: saleItems,
        businessDate,
        config: context.config,
        ip: context.ip,
      });
      credit = result.credit;
      deposit = result.deposit;
      run(db, 'UPDATE sales SET credit_id = ? WHERE id = ?', credit.id, saleId);
    }

    logAudit(db, {
      action: 'sale.create',
      entityType: 'sale',
      entityId: saleId,
      details: {
        receiptNo,
        total: fromCents(totalCents),
        discount: fromCents(discountCents),
        paymentMode,
        items: lines,
        mpesaCode: mpesa?.code || null,
        creditId: credit?.id ?? null,
      },
      ip: context.ip,
    });

    return getSale(db, saleId);
  });

  return { sale, credit, deposit };
}

export function listRefunds(
  db: DatabaseSync,
  options: { from?: string; to?: string; limit?: number } = {},
): RefundRecord[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.from) {
    where.push('r.business_date >= ?');
    params.push(options.from);
  }
  if (options.to) {
    where.push('r.business_date <= ?');
    params.push(options.to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  return all<RefundRow & { receipt_no: string }>(
    db,
    `SELECT r.*, s.receipt_no FROM refunds r JOIN sales s ON s.id = r.sale_id
     ${clause} ORDER BY r.created_at DESC LIMIT ?`,
    ...params,
    limit,
  ).map((row) => mapRefund(db, row, row.receipt_no));
}

interface RefundLineInput {
  saleItemId: string;
  quantity: number;
}

function parseRefundLines(value: unknown): RefundLineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'Choose at least one item to refund.');
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = requireObject(entry, 'Refund item');
    const saleItemId = requiredString(item.saleItemId, 'Sale item', { max: 100 });
    if (seen.has(saleItemId)) throw new HttpError(400, 'Duplicate refund line.');
    seen.add(saleItemId);
    return {
      saleItemId,
      quantity: requiredInt(item.quantity, 'Refund quantity', { min: 1, max: 100_000 }),
    };
  });
}

export function createRefund(
  db: DatabaseSync,
  saleId: string,
  body: Record<string, unknown>,
  context: SaleContext,
): { refund: RefundRecord; sale: SaleTransaction } {
  const lines = parseRefundLines(body.items);
  const method = oneOf(body.method ?? 'Cash', ['Cash', 'Mpesa'] as const, 'Refund method');
  const reason = requiredString(body.reason, 'Refund reason', { min: 3, max: 200 });
  const note = optionalString(body.note, 'Refund note', { max: 300 });
  const restock = optionalBoolean(body.restock, true);

  const result = withTransaction(db, () => {
    const saleRow = get<SaleRow>(db, 'SELECT * FROM sales WHERE id = ?', saleId);
    if (!saleRow) throw new HttpError(404, 'Sale not found.');
    if (saleRow.status === 'Refunded') throw new HttpError(409, 'This sale is already fully refunded.');

    const itemRows = all<SaleItemRow>(
      db,
      'SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid ASC',
      saleId,
    );
    if (itemRows.length === 0) throw new HttpError(409, 'This sale has no items to refund.');

    const itemById = new Map(itemRows.map((row) => [row.id, row]));
    for (const line of lines) {
      const item = itemById.get(line.saleItemId);
      if (!item) throw new HttpError(400, 'A refund item does not belong to this sale.');
      const remainingQuantity = item.quantity - item.refunded_quantity;
      if (line.quantity > remainingQuantity) {
        throw new HttpError(
          400,
          `${item.product_name} has only ${remainingQuantity} unit(s) left to refund.`,
        );
      }
    }

    let refundCents = 0;
    let refundedItems: Array<{ saleItemId: string; quantity: number }> = [];
    try {
      const allocation = computeRefundAllocation(
        itemRows.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          refundedQuantity: item.refunded_quantity,
        })),
        saleRow.total_cents,
        lines,
      );
      refundCents = allocation.totalCents;
      refundedItems = allocation.lines.map((line) => ({
        saleItemId: line.saleItemId,
        quantity: line.quantity,
      }));
    } catch {
      throw new HttpError(400, 'The refund quantities are invalid. Reload the sale and try again.');
    }
    if (refundedItems.length === 0) {
      throw new HttpError(400, 'Choose at least one item to refund.');
    }

    const now = nowIso();
    const businessDate = todayFor(context.config.timezone);
    const refundId = newId('refund');
    const refundNo = `RF-${nextCounter(db, 'refund')}`;

    run(
      db,
      `INSERT INTO refunds (
        id, refund_no, sale_id, total_cents, method, reason, restocked, cashier, note,
        business_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      refundId,
      refundNo,
      saleId,
      refundCents,
      method,
      reason,
      restock ? 1 : 0,
      context.cashier,
      note,
      businessDate,
      now,
    );

    for (const refunded of refundedItems) {
      const item = itemRows.find((row) => row.id === refunded.saleItemId) as SaleItemRow;
      const update = run(
        db,
        `UPDATE sale_items SET refunded_quantity = refunded_quantity + ?
         WHERE id = ? AND refunded_quantity + ? <= quantity`,
        refunded.quantity,
        refunded.saleItemId,
        refunded.quantity,
      );
      if (update.changes !== 1) {
        throw new HttpError(409, 'Refund quantities changed. Reload the sale and try again.');
      }
      run(
        db,
        `INSERT INTO refund_items (id, refund_id, sale_item_id, product_id, quantity, unit_price_cents, restock)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId('ri'),
        refundId,
        refunded.saleItemId,
        item.product_id,
        refunded.quantity,
        item.unit_price_cents,
        restock ? 1 : 0,
      );
      if (restock) {
        run(
          db,
          'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?',
          refunded.quantity,
          now,
          item.product_id,
        );
        recordStockMovement(db, {
          productId: item.product_id,
          delta: refunded.quantity,
          reason: 'refund',
          referenceId: refundId,
          note: `Restocked from ${refundNo}`,
          businessDate,
          createdAt: now,
        });
      }
    }

    const totals = get<{ total_qty: number; refunded_qty: number }>(
      db,
      `SELECT SUM(quantity) AS total_qty, SUM(refunded_quantity) AS refunded_qty
       FROM sale_items WHERE sale_id = ?`,
      saleId,
    );
    const fullyRefunded = Number(totals?.total_qty ?? 0) <= Number(totals?.refunded_qty ?? 0);
    const status = fullyRefunded ? 'Refunded' : 'Partially Refunded';
    run(db, 'UPDATE sales SET status = ? WHERE id = ?', status, saleId);

    if (saleRow.credit_id) {
      applyRefundToCredit(db, saleId, refundCents, refundedItems);
    }

    logAudit(db, {
      action: 'sale.refund',
      entityType: 'sale',
      entityId: saleId,
      details: {
        refundNo,
        amount: fromCents(refundCents),
        method,
        restock,
        reason,
        status,
      },
      ip: context.ip,
    });

    const refundRow = get<RefundRow>(db, 'SELECT * FROM refunds WHERE id = ?', refundId) as RefundRow;
    return { refund: mapRefund(db, refundRow, saleRow.receipt_no), sale: getSale(db, saleId) };
  });

  return result;
}
