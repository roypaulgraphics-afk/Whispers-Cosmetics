import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRefundAllocation, type RefundCalcItem } from '../src/lib/refunds';

const items: RefundCalcItem[] = [
  { id: 'a', quantity: 3, unitPriceCents: 1000, refundedQuantity: 0 },
  { id: 'b', quantity: 2, unitPriceCents: 2500, refundedQuantity: 0 },
];

test('full refund of every line sums exactly to the discounted sale total', () => {
  const allocation = computeRefundAllocation(items, 7400, [
    { saleItemId: 'a', quantity: 3 },
    { saleItemId: 'b', quantity: 2 },
  ]);
  assert.equal(allocation.totalCents, 7400);
  assert.equal(
    allocation.lines.reduce((sum, line) => sum + line.amountCents, 0),
    7400,
  );
});

test('partial refunds prorate the line net amount', () => {
  const allocation = computeRefundAllocation(items, 7400, [{ saleItemId: 'a', quantity: 2 }]);
  assert.deepEqual(allocation.lines, [{ saleItemId: 'a', quantity: 2, amountCents: 1850 }]);
  assert.equal(allocation.totalCents, 1850);
});

test('sequential refunds of one line add up to its full net amount without drift', () => {
  const first = computeRefundAllocation(items, 7400, [{ saleItemId: 'a', quantity: 1 }]);
  const second = computeRefundAllocation(
    [{ ...items[0], refundedQuantity: 1 }, items[1]],
    7400,
    [{ saleItemId: 'a', quantity: 2 }],
  );
  assert.equal(first.totalCents + second.totalCents, 2775);
});

test('refunds after an earlier partial refund only charge the remaining units', () => {
  const allocation = computeRefundAllocation(
    [{ id: 'a', quantity: 3, unitPriceCents: 1000, refundedQuantity: 1 }],
    2775,
    [{ saleItemId: 'a', quantity: 2 }],
  );
  assert.equal(allocation.totalCents, 1850);
});

test('rounding is reconciled across lines so nothing is lost', () => {
  const allocation = computeRefundAllocation(
    [
      { id: 'x', quantity: 1, unitPriceCents: 1, refundedQuantity: 0 },
      { id: 'y', quantity: 1, unitPriceCents: 1, refundedQuantity: 0 },
      { id: 'z', quantity: 1, unitPriceCents: 1, refundedQuantity: 0 },
    ],
    100,
    [
      { saleItemId: 'x', quantity: 1 },
      { saleItemId: 'y', quantity: 1 },
      { saleItemId: 'z', quantity: 1 },
    ],
  );
  assert.equal(allocation.totalCents, 100);
});

test('rejects zero, negative and over-refund quantities', () => {
  assert.throws(() => computeRefundAllocation(items, 7400, [{ saleItemId: 'a', quantity: 0 }]), RangeError);
  assert.throws(() => computeRefundAllocation(items, 7400, [{ saleItemId: 'a', quantity: -1 }]), RangeError);
  assert.throws(() => computeRefundAllocation(items, 7400, [{ saleItemId: 'a', quantity: 4 }]), RangeError);
  assert.throws(
    () =>
      computeRefundAllocation([{ ...items[0], refundedQuantity: 2 }, items[1]], 7400, [
        { saleItemId: 'a', quantity: 2 },
      ]),
    RangeError,
  );
});

test('empty carts and zero-value sales produce an empty allocation', () => {
  assert.deepEqual(computeRefundAllocation([], 500, [{ saleItemId: 'a', quantity: 1 }]), {
    totalCents: 0,
    lines: [],
  });
  assert.deepEqual(
    computeRefundAllocation([{ ...items[0], unitPriceCents: 0 }], 500, [
      { saleItemId: 'a', quantity: 1 },
    ]),
    { totalCents: 0, lines: [] },
  );
});
