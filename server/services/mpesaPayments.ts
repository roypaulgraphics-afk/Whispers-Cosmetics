import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config';
import { get } from '../db';
import { HttpError } from '../errors';
import { fromCents, toCents } from '../money';
import { parseMpesaMessage } from '../../src/lib/mpesaParser';
import { nowIso } from '../time';
import { optionalString, requireObject } from '../validation';

export interface ManualMpesaInput {
  transactionCode: string;
  amountReceived: number;
  senderName: string;
  senderPhone: string;
  rawMessage: string;
  timestamp: string;
}

export interface ValidatedMpesa {
  code: string;
  phone: string;
  senderName: string;
  rawMessage: string;
  timestamp: string;
  intentId?: string;
  mode: 'stk' | 'manual';
}

export function assertMpesaCodeUnused(db: DatabaseSync, code: string): void {
  const inSales = get<{ id: string }>(db, 'SELECT id FROM sales WHERE mpesa_code = ?', code);
  if (inSales) {
    throw new HttpError(409, 'That M-Pesa code has already been recorded on another sale.');
  }
  const inPayments = get<{ id: string }>(
    db,
    'SELECT id FROM credit_payments WHERE mpesa_code = ?',
    code,
  );
  if (inPayments) {
    throw new HttpError(409, 'That M-Pesa code has already been recorded on a credit payment.');
  }
}

export function validateManualMpesa(
  db: DatabaseSync,
  value: unknown,
  expectedCents: number,
  config: AppConfig,
): ValidatedMpesa {
  if (!config.manualMpesaEnabled) {
    throw new HttpError(403, 'Manual M-Pesa codes are disabled. Use an STK Push instead.');
  }
  const input = requireObject(value, 'M-Pesa details') as Record<string, unknown>;
  const rawCode = optionalString(input.transactionCode, 'M-Pesa transaction code', { max: 20 })
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!/^[A-Z0-9]{8,12}$/.test(rawCode)) {
    throw new HttpError(400, 'Enter a valid M-Pesa transaction code (8-12 characters).');
  }
  if (input.amountReceived === undefined || input.amountReceived === null || input.amountReceived === '') {
    throw new HttpError(400, 'Enter the amount shown on the M-Pesa message.');
  }
  const received = toCents(input.amountReceived, 'M-Pesa amount');
  if (received !== expectedCents) {
    throw new HttpError(
      400,
      `M-Pesa amount ${fromCents(received).toLocaleString()} does not match the required ${fromCents(expectedCents).toLocaleString()}.`,
    );
  }

  const rawMessage = optionalString(input.rawMessage, 'M-Pesa message', { max: 1000 });
  if (rawMessage) {
    const parsed = parseMpesaMessage(rawMessage, fromCents(expectedCents));
    if (parsed.details.transactionCode && parsed.details.transactionCode !== rawCode) {
      throw new HttpError(400, 'The M-Pesa message code does not match the code you entered.');
    }
    if (parsed.details.amountReceived > 0 && toCents(parsed.details.amountReceived) !== expectedCents) {
      throw new HttpError(400, 'The M-Pesa message amount does not match the amount due.');
    }
  }

  assertMpesaCodeUnused(db, rawCode);

  return {
    code: rawCode,
    phone: optionalString(input.senderPhone, 'M-Pesa phone', { max: 30 }),
    senderName: optionalString(input.senderName, 'M-Pesa sender', { max: 80 }),
    rawMessage,
    timestamp: nowIso(),
    mode: 'manual',
  };
}

export interface IntentRow {
  id: string;
  purpose: 'sale' | 'credit';
  amount_cents: number;
  phone: string;
  status: string;
  result_code: string | null;
  result_desc: string | null;
  mpesa_receipt: string | null;
  checkout_request_id: string | null;
  used_by_type: string | null;
  used_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export function getIntent(db: DatabaseSync, id: string): IntentRow {
  const row = get<IntentRow>(db, 'SELECT * FROM mpesa_intents WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'M-Pesa payment request not found.');
  return row;
}

export function validateStkIntent(
  db: DatabaseSync,
  value: unknown,
  expectedCents: number,
  purpose: 'sale' | 'credit',
): ValidatedMpesa & { intent: IntentRow } {
  const input = requireObject(value, 'M-Pesa payment');
  const intentId = optionalString(input.intentId, 'M-Pesa payment request', { max: 80 });
  if (!intentId) throw new HttpError(400, 'M-Pesa payment request is required.');
  const intent = getIntent(db, intentId);
  if (intent.purpose !== purpose) {
    throw new HttpError(400, 'This M-Pesa payment request belongs to a different checkout.');
  }
  if (intent.status !== 'success') {
    throw new HttpError(409, 'M-Pesa payment has not been confirmed yet.');
  }
  if (intent.used_by_id) {
    throw new HttpError(409, 'This M-Pesa payment has already been used.');
  }
  if (intent.amount_cents !== expectedCents) {
    throw new HttpError(409, 'The M-Pesa payment amount does not match the sale total.');
  }
  if (intent.mpesa_receipt) {
    assertMpesaCodeUnused(db, intent.mpesa_receipt);
  }
  return {
    code: intent.mpesa_receipt ?? '',
    phone: intent.phone,
    senderName: '',
    rawMessage: intent.result_desc ?? '',
    timestamp: nowIso(),
    intentId: intent.id,
    mode: 'stk',
    intent,
  };
}

export function markIntentUsed(
  db: DatabaseSync,
  intentId: string,
  usedByType: 'sale' | 'credit_payment',
  usedById: string,
): void {
  const result = db
    .prepare('UPDATE mpesa_intents SET used_by_type = ?, used_by_id = ?, updated_at = ? WHERE id = ? AND used_by_id IS NULL')
    .run(usedByType, usedById, nowIso(), intentId);
  if (Number(result.changes) !== 1) {
    throw new HttpError(409, 'This M-Pesa payment has already been used.');
  }
}

export function validateMpesaPayment(
  db: DatabaseSync,
  value: unknown,
  expectedCents: number,
  purpose: 'sale' | 'credit',
  config: AppConfig,
): ValidatedMpesa {
  const input = requireObject(value, 'M-Pesa payment');
  if (optionalString(input.intentId, 'M-Pesa payment request', { max: 80 })) {
    const { intent: _intent, ...validated } = validateStkIntent(db, input, expectedCents, purpose);
    return validated;
  }
  return validateManualMpesa(db, input, expectedCents, config);
}
