import type { DatabaseSync } from 'node:sqlite';
import type {
  CreditPayment,
  CreditRecord,
  MpesaDetails,
  SaleItem,
} from '../../src/types';
import type { AppConfig } from '../config';
import { all, get, newId, run, withTransaction } from '../db';
import { HttpError } from '../errors';
import { fromCents, toCents } from '../money';
import { nowIso, todayFor } from '../time';
import { logAudit } from '../audit';
import {
  isoDateOnly,
  optionalString,
  requireObject,
  requiredString,
  oneOf,
} from '../validation';
import {
  markIntentUsed,
  validateMpesaPayment,
  type ValidatedMpesa,
} from './mpesaPayments';

export interface CreditRow {
  id: string;
  creditor_name: string;
  creditor_phone: string;
  pending_date: string;
  due_date: string;
  items_json: string;
  total_cents: number;
  amount_paid_cents: number;
  notes: string;
  sale_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreditPaymentRow {
  id: string;
  credit_id: string;
  amount_cents: number;
  method: 'Cash' | 'Mpesa';
  mpesa_code: string | null;
  mpesa_phone: string | null;
  mpesa_sender_name: string | null;
  mpesa_raw_message: string | null;
  note: string;
  paid_at: string;
  business_date: string;
}

function parseItems(itemsJson: string): SaleItem[] {
  try {
    const parsed = JSON.parse(itemsJson) as SaleItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapPayment(row: CreditPaymentRow): CreditPayment {
  let mpesaDetails: MpesaDetails | undefined;
  if (row.method === 'Mpesa') {
    mpesaDetails = {
      transactionCode: row.mpesa_code ?? '',
      senderName: row.mpesa_sender_name ?? '',
      senderPhone: row.mpesa_phone ?? '',
      amountReceived: fromCents(row.amount_cents),
      rawMessage: row.mpesa_raw_message ?? '',
      verified: true,
      timestamp: row.paid_at,
      mode: 'manual',
    };
  }
  return {
    id: row.id,
    amount: fromCents(row.amount_cents),
    method: row.method,
    mpesaDetails,
    paidAt: row.paid_at,
    note: row.note || undefined,
  };
}

export function mapCredit(db: DatabaseSync, row: CreditRow): CreditRecord {
  const payments = all<CreditPaymentRow>(
    db,
    'SELECT * FROM credit_payments WHERE credit_id = ? ORDER BY paid_at ASC',
    row.id,
  ).map(mapPayment);
  return {
    id: row.id,
    creditorName: row.creditor_name,
    creditorPhone: row.creditor_phone,
    pendingDate: row.pending_date,
    dueDate: row.due_date,
    items: parseItems(row.items_json),
    totalAmount: fromCents(row.total_cents),
    amountPaid: fromCents(row.amount_paid_cents),
    notes: row.notes,
    payments,
    saleId: row.sale_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCredit(db: DatabaseSync, id: string): CreditRecord {
  const row = get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Credit record not found.');
  return mapCredit(db, row);
}

export function listCredits(db: DatabaseSync): CreditRecord[] {
  return all<CreditRow>(db, 'SELECT * FROM credits ORDER BY created_at DESC').map((row) =>
    mapCredit(db, row),
  );
}

export interface CreditInput {
  customerName: unknown;
  customerPhone?: unknown;
  dueDate: unknown;
  notes?: unknown;
  amountPaid?: unknown;
  paymentMethod?: unknown;
  mpesa?: unknown;
}

function validatePhone(value: unknown): string {
  const phone = optionalString(value, 'Customer phone', { max: 30 });
  if (phone && !/^[0-9+()\s-]{7,30}$/.test(phone)) {
    throw new HttpError(400, 'Customer phone must contain digits only (e.g. 0712 345 678).');
  }
  return phone;
}

function insertMpesaPayment(
  db: DatabaseSync,
  creditId: string,
  amountCents: number,
  mpesa: ValidatedMpesa,
  note: string,
  businessDate: string,
  createdAt: string,
): CreditPaymentRow {
  const id = newId('cp');
  run(
    db,
    `INSERT INTO credit_payments (
      id, credit_id, amount_cents, method, mpesa_code, mpesa_phone, mpesa_sender_name,
      mpesa_raw_message, note, paid_at, business_date
    ) VALUES (?, ?, ?, 'Mpesa', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    creditId,
    amountCents,
    mpesa.code || null,
    mpesa.phone || null,
    mpesa.senderName || null,
    mpesa.rawMessage || null,
    note,
    createdAt,
    businessDate,
  );
  if (mpesa.intentId) {
    markIntentUsed(db, mpesa.intentId, 'credit_payment', id);
  }
  return get<CreditPaymentRow>(db, 'SELECT * FROM credit_payments WHERE id = ?', id) as CreditPaymentRow;
}

export interface SaleCreditResult {
  credit: CreditRecord;
  deposit?: CreditPayment;
}

export function createSaleCredit(
  db: DatabaseSync,
  input: CreditInput,
  context: {
    saleId: string;
    totalCents: number;
    items: SaleItem[];
    businessDate: string;
    config: AppConfig;
    ip: string;
  },
): SaleCreditResult {
  const raw = requireObject(input, 'Credit details');
  const name = requiredString(raw.customerName, 'Customer name', { max: 80 });
  if (name.length < 2) throw new HttpError(400, 'Customer name is required.');
  const phone = validatePhone(raw.customerPhone);
  const dueDate = isoDateOnly(raw.dueDate, 'Due date');
  if (dueDate < context.businessDate) {
    throw new HttpError(400, 'The credit due date cannot be before the sale date.');
  }
  const notes = optionalString(raw.notes, 'Credit notes', { max: 500 });

  const depositCents =
    raw.amountPaid === undefined || raw.amountPaid === null || raw.amountPaid === ''
      ? 0
      : toCents(raw.amountPaid, 'Deposit');
  if (depositCents > context.totalCents) {
    throw new HttpError(400, 'The deposit cannot be more than the credit total.');
  }
  const depositMethod =
    depositCents > 0 ? oneOf(raw.paymentMethod ?? 'Cash', ['Cash', 'Mpesa'] as const, 'Deposit method') : 'Cash';

  let mpesa: ValidatedMpesa | null = null;
  if (depositCents > 0 && depositMethod === 'Mpesa') {
    if (!raw.mpesa) throw new HttpError(400, 'Enter the M-Pesa details for this deposit.');
    mpesa = validateMpesaPayment(db, raw.mpesa, depositCents, 'credit', context.config);
  }

  const id = newId('credit');
  const now = nowIso();
  run(
    db,
    `INSERT INTO credits (
      id, creditor_name, creditor_phone, pending_date, due_date, items_json,
      total_cents, amount_paid_cents, notes, sale_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    phone,
    context.businessDate,
    dueDate,
    JSON.stringify(context.items),
    context.totalCents,
    depositCents,
    notes,
    context.saleId,
    now,
    now,
  );

  let deposit: CreditPayment | undefined;
  if (depositCents > 0) {
    let paymentRow: CreditPaymentRow;
    if (mpesa) {
      paymentRow = insertMpesaPayment(
        db,
        id,
        depositCents,
        mpesa,
        'Deposit at sale',
        context.businessDate,
        now,
      );
    } else {
      const paymentId = newId('cp');
      run(
        db,
        `INSERT INTO credit_payments (id, credit_id, amount_cents, method, note, paid_at, business_date)
         VALUES (?, ?, ?, 'Cash', 'Deposit at sale', ?, ?)`,
        paymentId,
        id,
        depositCents,
        now,
        context.businessDate,
      );
      paymentRow = get<CreditPaymentRow>(
        db,
        'SELECT * FROM credit_payments WHERE id = ?',
        paymentId,
      ) as CreditPaymentRow;
    }
    deposit = mapPayment(paymentRow);
  }

  logAudit(db, {
    action: 'credit.create',
    entityType: 'credit',
    entityId: id,
    details: {
      customer: name,
      phone,
      total: fromCents(context.totalCents),
      deposit: fromCents(depositCents),
      saleId: context.saleId,
    },
    ip: context.ip,
  });

  return { credit: mapCredit(db, { ...get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', id) as CreditRow }), deposit };
}

export interface CreditPaymentInput {
  amount: unknown;
  method: unknown;
  mpesa?: unknown;
  note?: unknown;
}

export function recordCreditPayment(
  db: DatabaseSync,
  creditId: string,
  input: CreditPaymentInput,
  config: AppConfig,
  ip: string,
): { credit: CreditRecord; payment: CreditPayment } {
  const raw = requireObject(input, 'Payment details');
  const amountCents = toCents(raw.amount, 'Payment amount');
  if (amountCents <= 0) throw new HttpError(400, 'Payment amount must be greater than zero.');
  const method = oneOf(raw.method, ['Cash', 'Mpesa'] as const, 'Payment method');
  const note = optionalString(raw.note, 'Payment note', { max: 200 });

  return withTransaction(db, () => {
    const row = get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', creditId);
    if (!row) throw new HttpError(404, 'Credit record not found.');
    const balance = Math.max(0, row.total_cents - row.amount_paid_cents);
    if (balance <= 0) throw new HttpError(409, 'This credit is already fully paid.');
    if (amountCents > balance) {
      throw new HttpError(
        400,
        `Payment cannot exceed the outstanding balance of ${fromCents(balance).toLocaleString()}.`,
      );
    }

    let mpesa: ValidatedMpesa | null = null;
    if (method === 'Mpesa') {
      if (!raw.mpesa) throw new HttpError(400, 'Enter the M-Pesa details for this payment.');
      mpesa = validateMpesaPayment(db, raw.mpesa, amountCents, 'credit', config);
    }

    const now = nowIso();
    const businessDate = todayFor(config.timezone);
    let paymentRow: CreditPaymentRow;
    if (mpesa) {
      paymentRow = insertMpesaPayment(db, creditId, amountCents, mpesa, note, businessDate, now);
    } else {
      const paymentId = newId('cp');
      run(
        db,
        `INSERT INTO credit_payments (id, credit_id, amount_cents, method, note, paid_at, business_date)
         VALUES (?, ?, ?, 'Cash', ?, ?, ?)`,
        paymentId,
        creditId,
        amountCents,
        note,
        now,
        businessDate,
      );
      paymentRow = get<CreditPaymentRow>(
        db,
        'SELECT * FROM credit_payments WHERE id = ?',
        paymentId,
      ) as CreditPaymentRow;
    }

    run(
      db,
      'UPDATE credits SET amount_paid_cents = amount_paid_cents + ?, updated_at = ? WHERE id = ?',
      amountCents,
      now,
      creditId,
    );
    logAudit(db, {
      action: 'credit.payment',
      entityType: 'credit',
      entityId: creditId,
      details: { amount: fromCents(amountCents), method, mpesaCode: mpesa?.code || null, note },
      ip,
    });

    return { credit: getCredit(db, creditId), payment: mapPayment(paymentRow) };
  });
}

export function updateCredit(
  db: DatabaseSync,
  creditId: string,
  body: Record<string, unknown>,
  ip: string,
): CreditRecord {
  return withTransaction(db, () => {
    const row = get<CreditRow>(db, 'SELECT * FROM credits WHERE id = ?', creditId);
    if (!row) throw new HttpError(404, 'Credit record not found.');
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const name = has('customerName')
      ? requiredString(body.customerName, 'Customer name', { min: 2, max: 80 })
      : row.creditor_name;
    const phone = has('customerPhone') ? validatePhone(body.customerPhone) : row.creditor_phone;
    const dueDate = has('dueDate') ? isoDateOnly(body.dueDate, 'Due date') : row.due_date;
    const notes = has('notes') ? optionalString(body.notes, 'Credit notes', { max: 500 }) : row.notes;
    const now = nowIso();

    run(
      db,
      `UPDATE credits SET creditor_name = ?, creditor_phone = ?, due_date = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      name,
      phone,
      dueDate,
      notes,
      now,
      creditId,
    );
    logAudit(db, {
      action: 'credit.update',
      entityType: 'credit',
      entityId: creditId,
      details: { name, phone, dueDate, notes },
      ip,
    });
    return getCredit(db, creditId);
  });
}

export function applyRefundToCredit(
  db: DatabaseSync,
  saleId: string,
  refundCents: number,
  refundedItems: Array<{ saleItemId: string; quantity: number }>,
): void {
  const credit = get<CreditRow>(
    db,
    'SELECT * FROM credits WHERE sale_id = ? ORDER BY created_at DESC LIMIT 1',
    saleId,
  );
  if (!credit) return;

  const items = parseItems(credit.items_json);
  for (const refunded of refundedItems) {
    const item = items.find((entry) => entry.id === refunded.saleItemId);
    if (item) {
      item.refundedQuantity = (item.refundedQuantity ?? 0) + refunded.quantity;
    }
  }
  const nextTotal = Math.max(
    credit.amount_paid_cents,
    credit.total_cents - Math.round(refundCents),
  );
  run(
    db,
    'UPDATE credits SET total_cents = ?, items_json = ?, updated_at = ? WHERE id = ?',
    nextTotal,
    JSON.stringify(items),
    nowIso(),
    credit.id,
  );
}
