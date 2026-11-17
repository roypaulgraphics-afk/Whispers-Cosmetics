import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSimulatedMpesaSms, parseMpesaMessage } from '../src/lib/mpesaParser';

test('parses a till-number confirmation SMS', () => {
  const result = parseMpesaMessage(
    'UK48M92LP1 Confirmed. Ksh1,450.00 received from GRACE WANJIKU 0712345678 on 13/11/26 at 10:15 AM.',
    1450,
  );
  assert.equal(result.valid, true);
  assert.equal(result.details.transactionCode, 'UK48M92LP1');
  assert.equal(result.details.amountReceived, 1450);
  assert.equal(result.details.senderPhone, '0712345678');
  assert.equal(result.details.senderName, 'GRACE WANJIKU');
});

test('parses a paybill-style message without a phone number', () => {
  const result = parseMpesaMessage(
    'UK48M92LP1 Confirmed. Ksh2,200.00 paid to WHISPERS COSMETICS. on 13/11/26 at 2:30 PM. New M-PESA balance is Ksh5,000.',
  );
  assert.equal(result.valid, true);
  assert.equal(result.details.transactionCode, 'UK48M92LP1');
  assert.equal(result.details.amountReceived, 2200);
  assert.equal(result.details.senderName, 'Customer (WHISPERS COSMETICS)');
});

test('flags an amount shortfall', () => {
  const result = parseMpesaMessage('UK48M92LP1 Confirmed. Ksh500.00 received from JOHN DOE 0722000000.', 600);
  assert.equal(result.valid, false);
  assert.equal(result.details.verified, false);
  assert.match(result.reason ?? '', /Shortfall/);
});

test('flags an overpayment', () => {
  const result = parseMpesaMessage(
    'UK48M92LP1 Confirmed. Ksh1,000.00 received from JOHN DOE 0722000000.',
    600,
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? '', /Overpayment/);
});

test('rejects empty and code-less messages', () => {
  const empty = parseMpesaMessage('   ');
  assert.equal(empty.valid, false);
  assert.match(empty.reason ?? '', /Paste or import/);

  const noCode = parseMpesaMessage('Confirmed. Ksh500.00 received from JOHN DOE 0722000000.');
  assert.equal(noCode.valid, false);
  assert.match(noCode.reason ?? '', /transaction code/);
});

test('accepts lowercase codes and normalises them', () => {
  const result = parseMpesaMessage('uk48m92lp1 confirmed. Ksh 350.00 received from JANE 0712345678.', 350);
  assert.equal(result.valid, true);
  assert.equal(result.details.transactionCode, 'UK48M92LP1');
});

test('generated demo SMS can be parsed back', () => {
  const sms = generateSimulatedMpesaSms(1450);
  const result = parseMpesaMessage(sms, 1450);
  assert.equal(result.valid, true);
  assert.equal(result.details.amountReceived, 1450);
  assert.match(result.details.transactionCode, /^UK[A-Z0-9]{8}$/);
});
