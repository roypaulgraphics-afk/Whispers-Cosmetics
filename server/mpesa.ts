import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config';
import { get, newId, run } from './db';
import { HttpError } from './errors';
import { fromCents, toCents } from './money';
import { logAudit } from './audit';
import { nowIso } from './time';
import type { MpesaInfo, MpesaIntentStatus } from '../src/types';
import { getIntent, type IntentRow } from './services/mpesaPayments';

interface StkPushResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface StkQueryResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
  ResultCode?: string;
  ResultDesc?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface TokenCache {
  key: string;
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export function mpesaClientInfo(config: AppConfig): MpesaInfo {
  return {
    configured: config.mpesa.enabled,
    environment: config.mpesa.environment,
    shortcode: config.mpesa.shortcode
      ? `${'*'.repeat(Math.max(0, config.mpesa.shortcode.length - 4))}${config.mpesa.shortcode.slice(-4)}`
      : undefined,
    reason: config.mpesa.enabled
      ? undefined
      : `Daraja is not configured. Missing: ${config.mpesa.missing.join(', ') || 'credentials'}.`,
    manualEnabled: config.manualMpesaEnabled,
  };
}

export function normalizeKenyanPhone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Enter a valid Kenyan M-Pesa phone number.');
  }
  const cleaned = value.replace(/[^\d+]/g, '');
  let digits = cleaned;
  if (digits.startsWith('+254')) digits = digits.slice(1);
  if (/^0[17]\d{8}$/.test(digits)) digits = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`;
  if (!/^254[17]\d{8}$/.test(digits)) {
    throw new HttpError(400, 'Enter a valid Kenyan M-Pesa phone number (e.g. 0712345678).');
  }
  return digits;
}

function darajaTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${read('year')}${read('month')}${read('day')}${read('hour')}${read('minute')}${read('second')}`;
}

function assertConfigured(config: AppConfig): void {
  if (!config.mpesa.enabled) {
    throw new HttpError(
      503,
      `M-Pesa STK Push is not configured. Missing: ${config.mpesa.missing.join(', ') || 'credentials'}.`,
      'MPESA_NOT_CONFIGURED',
    );
  }
  if (!config.mpesa.callbackUrl.startsWith('https://')) {
    throw new HttpError(
      503,
      'MPESA_CALLBACK_URL must be a public HTTPS URL for Safaricom to deliver payment callbacks.',
      'MPESA_CALLBACK_INSECURE',
    );
  }
}

async function getAccessToken(config: AppConfig): Promise<string> {
  const key = `${config.mpesa.environment}:${config.mpesa.consumerKey}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const basic = Buffer.from(
    `${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`,
  ).toString('base64');
  let response: Response;
  try {
    response = await fetch(
      `${config.mpesa.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${basic}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new HttpError(502, 'Could not reach Safaricom Daraja. Check the server internet connection.');
  }
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(502, `Safaricom authentication failed (${response.status}). Check the Daraja credentials.`);
  }
  let parsed: { access_token?: string; expires_in?: string | number };
  try {
    parsed = JSON.parse(text) as { access_token?: string; expires_in?: string | number };
  } catch {
    throw new HttpError(502, 'Safaricom returned an unexpected authentication response.');
  }
  if (!parsed.access_token) {
    throw new HttpError(502, 'Safaricom did not return an access token.');
  }
  const expiresSeconds = Number(parsed.expires_in ?? 3599);
  tokenCache = {
    key,
    token: parsed.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresSeconds) ? expiresSeconds : 3599) * 1000,
  };
  return parsed.access_token;
}

function stkPassword(config: AppConfig, timestamp: string): string {
  return Buffer.from(`${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`).toString(
    'base64',
  );
}

export async function initiateStkPush(
  db: DatabaseSync,
  config: AppConfig,
  input: {
    phone: unknown;
    amountCents: number;
    purpose: 'sale' | 'credit';
    accountReference?: string;
    description?: string;
    ip?: string;
  },
): Promise<{ intentId: string; status: string; message: string }> {
  assertConfigured(config);
  const phone = normalizeKenyanPhone(input.phone);
  if (input.amountCents % 100 !== 0) {
    throw new HttpError(
      400,
      'M-Pesa STK Push needs a whole-shilling amount. Adjust the discount so the total has no cents.',
    );
  }
  const amount = Math.round(input.amountCents / 100);
  if (amount < 1) throw new HttpError(400, 'M-Pesa amount must be at least Ksh 1.');
  if (amount > 250_000) throw new HttpError(400, 'M-Pesa amount exceeds the Daraja limit.');

  const intentId = newId('mpi');
  const createdAt = nowIso();
  run(
    db,
    `INSERT INTO mpesa_intents (
      id, purpose, amount_cents, phone, status, result_code, result_desc,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    intentId,
    input.purpose,
    input.amountCents,
    phone,
    createdAt,
    createdAt,
  );

  const timestamp = darajaTimestamp();
  const accountReference = (input.accountReference ?? 'Whispers')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12) || 'Whispers';
  const description = (input.description ?? 'Cosmetics order').slice(0, 20);
  const token = await getAccessToken(config);

  let response: Response;
  try {
    response = await fetch(`${config.mpesa.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: config.mpesa.shortcode,
        Password: stkPassword(config, timestamp),
        Timestamp: timestamp,
        TransactionType: config.mpesa.transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: config.mpesa.shortcode,
        PhoneNumber: phone,
        CallBackURL: config.mpesa.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: description,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    run(
      db,
      "UPDATE mpesa_intents SET status = 'error', result_desc = ?, updated_at = ? WHERE id = ?",
      'Could not reach Safaricom Daraja',
      nowIso(),
      intentId,
    );
    throw new HttpError(502, 'Could not reach Safaricom Daraja. Try again or record the M-Pesa code manually.');
  }

  const text = await response.text();
  let parsed: StkPushResponse = {};
  try {
    parsed = JSON.parse(text) as StkPushResponse;
  } catch {
    // handled below
  }

  if (!response.ok || parsed.ResponseCode !== '0') {
    const message =
      parsed.errorMessage ||
      parsed.ResponseDescription ||
      `Daraja rejected the STK Push (HTTP ${response.status}).`;
    run(
      db,
      "UPDATE mpesa_intents SET status = 'error', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ?",
      parsed.errorCode ?? parsed.ResponseCode ?? String(response.status),
      message.slice(0, 500),
      nowIso(),
      intentId,
    );
    logAudit(db, {
      action: 'mpesa.stk_push_failed',
      entityType: 'mpesa_intent',
      entityId: intentId,
      details: { message, environment: config.mpesa.environment },
      ip: input.ip,
    });
    throw new HttpError(502, message);
  }

  run(
    db,
    `UPDATE mpesa_intents SET merchant_request_id = ?, checkout_request_id = ?, result_desc = ?, updated_at = ?
     WHERE id = ?`,
    parsed.MerchantRequestID ?? null,
    parsed.CheckoutRequestID ?? null,
    parsed.CustomerMessage ?? 'STK Push sent',
    nowIso(),
    intentId,
  );
  logAudit(db, {
    action: 'mpesa.stk_push',
    entityType: 'mpesa_intent',
    entityId: intentId,
    details: {
      purpose: input.purpose,
      amount,
      phone,
      checkoutRequestId: parsed.CheckoutRequestID,
    },
    ip: input.ip,
  });

  return {
    intentId,
    status: 'pending',
    message: parsed.CustomerMessage ?? 'STK Push sent. Ask the customer to enter their M-Pesa PIN.',
  };
}

async function queryStkPush(
  db: DatabaseSync,
  config: AppConfig,
  intent: IntentRow,
): Promise<void> {
  if (!intent.checkout_request_id) return;
  const timestamp = darajaTimestamp();
  const token = await getAccessToken(config);
  let response: Response;
  try {
    response = await fetch(`${config.mpesa.baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: config.mpesa.shortcode,
        Password: stkPassword(config, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: intent.checkout_request_id,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    run(
      db,
      'UPDATE mpesa_intents SET updated_at = ? WHERE id = ?',
      nowIso(),
      intent.id,
    );
    return;
  }

  const text = await response.text();
  let parsed: StkQueryResponse = {};
  try {
    parsed = JSON.parse(text) as StkQueryResponse;
  } catch {
    // ignore
  }
  const resultCode = String(parsed.ResultCode ?? parsed.ResponseCode ?? '');
  if (!response.ok || !resultCode) {
    run(db, 'UPDATE mpesa_intents SET updated_at = ? WHERE id = ?', nowIso(), intent.id);
    return;
  }

  if (resultCode === '0') {
    run(
      db,
      "UPDATE mpesa_intents SET status = 'success', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      resultCode,
      parsed.ResultDesc ?? 'Payment confirmed by Daraja',
      nowIso(),
      intent.id,
    );
    return;
  }

  if (resultCode === '1032') {
    run(
      db,
      "UPDATE mpesa_intents SET status = 'cancelled', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      resultCode,
      parsed.ResultDesc ?? 'Customer cancelled the prompt',
      nowIso(),
      intent.id,
    );
    return;
  }

  if (resultCode === '1037') {
    run(
      db,
      "UPDATE mpesa_intents SET status = 'timeout', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      resultCode,
      parsed.ResultDesc ?? 'The STK prompt timed out',
      nowIso(),
      intent.id,
    );
    return;
  }

  run(
    db,
    "UPDATE mpesa_intents SET status = 'failed', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    resultCode,
    (parsed.ResultDesc ?? 'M-Pesa payment failed').slice(0, 500),
    nowIso(),
    intent.id,
  );
}

function mapIntentStatus(intent: IntentRow): MpesaIntentStatus {
  return {
    id: intent.id,
    status: intent.status as MpesaIntentStatus['status'],
    resultCode: intent.result_code ?? undefined,
    resultDesc: intent.result_desc ?? undefined,
    mpesaReceipt: intent.mpesa_receipt ?? undefined,
    amount: fromCents(intent.amount_cents),
    phone: intent.phone,
  };
}

export async function refreshIntentStatus(
  db: DatabaseSync,
  config: AppConfig,
  intentId: string,
): Promise<MpesaIntentStatus> {
  let intent = getIntent(db, intentId);
  if (intent.status === 'pending') {
    const age = Date.now() - new Date(intent.checkout_request_id ? intent.updated_at : intent.created_at).getTime();
    if (age > 5 * 60 * 1000) {
      run(
        db,
        "UPDATE mpesa_intents SET status = 'timeout', result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        'No confirmation received from Safaricom after 5 minutes',
        nowIso(),
        intent.id,
      );
      intent = getIntent(db, intentId);
    } else if (intent.checkout_request_id && age > 8_000 && config.mpesa.enabled) {
      try {
        await queryStkPush(db, config, intent);
      } catch {
        // query failures keep the intent pending; callback may still arrive
      }
      intent = getIntent(db, intentId);
    }
  }
  return mapIntentStatus(intent);
}

interface CallbackMetadataItem {
  Name?: string;
  Value?: string | number;
}

interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: CallbackMetadataItem[] };
    };
  };
}

export function callbackSecretMatches(expected: string, provided: string): boolean {
  if (!expected || !provided || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

export function handleStkCallback(db: DatabaseSync, payload: unknown, config: AppConfig): boolean {
  const body = payload as StkCallbackBody;
  const callback = body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) return false;
  const row = get<IntentRow>(
    db,
    'SELECT * FROM mpesa_intents WHERE checkout_request_id = ?',
    callback.CheckoutRequestID,
  );
  if (!row) return false;
  if (row.status === 'success') return true;

  const resultCode = String(callback.ResultCode ?? '');
  const raw = JSON.stringify(payload).slice(0, 20_000);
  if (resultCode === '0') {
    const items = callback.CallbackMetadata?.Item ?? [];
    const read = (name: string) => items.find((item) => item.Name === name)?.Value;
    const amountValue = read('Amount');
    const receipt = String(read('MpesaReceiptNumber') ?? '').trim().toUpperCase();
    const amountCents = amountValue === undefined ? null : toCents(amountValue, 'Callback amount');
    if (amountCents !== row.amount_cents) {
      run(
        db,
        "UPDATE mpesa_intents SET status = 'error', result_code = ?, result_desc = ?, raw_callback = ?, updated_at = ? WHERE id = ?",
        'AMOUNT_MISMATCH',
        `Callback amount ${amountValue} does not match the requested amount`,
        raw,
        nowIso(),
        row.id,
      );
      logAudit(db, {
        action: 'mpesa.callback_amount_mismatch',
        entityType: 'mpesa_intent',
        entityId: row.id,
        details: { expected: fromCents(row.amount_cents), received: amountValue },
      });
      return true;
    }
    const phone = String(read('PhoneNumber') ?? row.phone);
    run(
      db,
      `UPDATE mpesa_intents SET status = 'success', result_code = ?, result_desc = ?, mpesa_receipt = ?,
        raw_callback = ?, updated_at = ? WHERE id = ?`,
      resultCode,
      callback.ResultDesc ?? 'Payment confirmed',
      receipt || null,
      raw,
      nowIso(),
      row.id,
    );
    logAudit(db, {
      action: 'mpesa.callback_success',
      entityType: 'mpesa_intent',
      entityId: row.id,
      details: { amount: fromCents(row.amount_cents), receipt, phone, environment: config.mpesa.environment },
    });
    return true;
  }

  const status = resultCode === '1032' ? 'cancelled' : resultCode === '1037' ? 'timeout' : 'failed';
  run(
    db,
    'UPDATE mpesa_intents SET status = ?, result_code = ?, result_desc = ?, raw_callback = ?, updated_at = ? WHERE id = ?',
    status,
    resultCode || null,
    (callback.ResultDesc ?? 'M-Pesa payment failed').slice(0, 500),
    raw,
    nowIso(),
    row.id,
  );
  logAudit(db, {
    action: 'mpesa.callback_failed',
    entityType: 'mpesa_intent',
    entityId: row.id,
    details: { status, resultCode, resultDesc: callback.ResultDesc },
  });
  return true;
}
