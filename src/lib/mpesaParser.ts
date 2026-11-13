import { MpesaDetails } from '../types';

export interface ParsedMpesaResult {
  valid: boolean;
  details: MpesaDetails;
  reason?: string;
}

/**
 * Parses standard Kenyan M-Pesa confirmation SMS messages (Till / Paybill / Send Money).
 * Example formats:
 * - "UK48M92LP1 Confirmed. Ksh1,450.00 received from GRACE WANJIKU 0712345678 on 13/11/26 at 10:15 AM."
 * - "UK48M92LP1 Confirmed. Ksh2,200.00 paid to WHISPERS COSMETICS. on 13/11/26 at 2:30 PM. New M-PESA balance is Ksh..."
 */
export function parseMpesaMessage(rawMessage: string, expectedAmount?: number): ParsedMpesaResult {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return {
      valid: false,
      details: {
        transactionCode: '',
        senderName: '',
        senderPhone: '',
        amountReceived: 0,
        rawMessage: '',
        verified: false,
        timestamp: new Date().toISOString(),
      },
      reason: 'Paste or import an M-Pesa confirmation SMS to verify.',
    };
  }

  // Extract 10-character alphanumeric M-Pesa code (usually starts with letter, uppercase)
  const codeMatch = trimmed.match(/\b([A-Z0-9]{9,12})\b(?=\s+Confirmed\.?)/i) || trimmed.match(/^([A-Z0-9]{8,12})\b/i);
  const transactionCode = codeMatch ? codeMatch[1].toUpperCase() : '';

  // Extract amount in Ksh / KES
  const amountMatch = trimmed.match(/(?:Ksh|KES)\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const amountReceived = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

  // Extract phone number (07xx, 01xx, 2547xx)
  const phoneMatch = trimmed.match(/(?:\+?254|0)[17]\d{8}/);
  const senderPhone = phoneMatch ? phoneMatch[0] : '';

  // Extract sender name after "received from" or before phone number
  let senderName = '';
  const fromMatch = trimmed.match(/received from\s+([A-Za-z\s.'-]+?)(?=\s+(?:\+?254|0)[17]\d{8}|\s+on\s+\d)/i);
  if (fromMatch) {
    senderName = fromMatch[1].trim();
  } else {
    const toMatch = trimmed.match(/paid to\s+([A-Za-z0-9\s.'-]+?)(?=\.\s*on|\s+on\s+\d)/i);
    if (toMatch) {
      senderName = `Customer (${toMatch[1].trim()})`;
    }
  }

  // Extract date/time if present
  const dateMatch = trimmed.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  const timestamp = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}` : new Date().toLocaleString();

  const hasCoreFields = Boolean(transactionCode && amountReceived > 0);
  const matchesExpected = expectedAmount === undefined || expectedAmount <= 0
    ? true
    : Math.abs(amountReceived - expectedAmount) < 0.01;

  let reason: string | undefined;
  if (!transactionCode) {
    reason = 'Could not detect an M-Pesa transaction code (e.g. UK48M92LP1).';
  } else if (amountReceived <= 0) {
    reason = 'Could not detect the Ksh amount in the message.';
  } else if (!matchesExpected && expectedAmount !== undefined) {
    reason = amountReceived < expectedAmount
      ? `Shortfall: M-Pesa SMS shows Ksh ${amountReceived.toLocaleString()}, expected Ksh ${expectedAmount.toLocaleString()}.`
      : `Overpayment notice: M-Pesa SMS shows Ksh ${amountReceived.toLocaleString()} for Ksh ${expectedAmount.toLocaleString()} total.`;
  }

  return {
    valid: hasCoreFields && matchesExpected,
    details: {
      transactionCode,
      senderName: senderName || 'M-Pesa Customer',
      senderPhone,
      amountReceived,
      rawMessage: trimmed,
      verified: hasCoreFields && matchesExpected,
      timestamp,
    },
    reason,
  };
}

export function generateSimulatedMpesaSms(amount: number, tillNumber = '5482910', sender = 'FAITH MUTISO', phone = '0724819302'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'UK';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const formattedAmt = amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `${code} Confirmed. Ksh${formattedAmt} received from ${sender} ${phone} via Till ${tillNumber} on ${dd}/${mm}/${yy} at ${timeStr}. New M-PESA business balance is Ksh${(42850 + amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
}
