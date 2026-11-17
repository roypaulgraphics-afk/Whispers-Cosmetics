export interface RefundCalcItem {
  id: string;
  quantity: number;
  unitPriceCents: number;
  refundedQuantity: number;
}

export interface RefundSelection {
  saleItemId: string;
  quantity: number;
}

export interface RefundAllocationLine {
  saleItemId: string;
  quantity: number;
  amountCents: number;
}

export interface RefundAllocation {
  totalCents: number;
  lines: RefundAllocationLine[];
}

/**
 * Distributes a sale total across its lines (handling order-level discounts),
 * then prorates each line by the quantity being returned. Full refunds of every
 * line always sum back to the original sale total with no rounding drift.
 */
export function computeRefundAllocation(
  items: RefundCalcItem[],
  totalCents: number,
  selections: RefundSelection[],
): RefundAllocation {
  if (items.length === 0) return { totalCents: 0, lines: [] };

  const grossTotal = items.reduce(
    (sum, item) => sum + Math.round(item.unitPriceCents) * item.quantity,
    0,
  );
  if (grossTotal <= 0) return { totalCents: 0, lines: [] };

  const lineNet = new Map<string, number>();
  let cumulative = 0;
  let previous = 0;
  for (const item of items) {
    cumulative += Math.round(item.unitPriceCents) * item.quantity;
    const allocated = Math.round((Math.round(totalCents) * cumulative) / grossTotal);
    lineNet.set(item.id, allocated - previous);
    previous = allocated;
  }

  const selected = new Map(selections.map((entry) => [entry.saleItemId, entry.quantity]));
  const lines: RefundAllocationLine[] = [];
  let refundTotal = 0;

  for (const item of items) {
    const requested = selected.get(item.id);
    if (requested === undefined) continue;
    const remaining = item.quantity - item.refundedQuantity;
    if (!Number.isInteger(requested) || requested < 1 || requested > remaining) {
      throw new RangeError(`Invalid refund quantity for item ${item.id}`);
    }
    const net = lineNet.get(item.id) ?? 0;
    const before = Math.round((net * item.refundedQuantity) / item.quantity);
    const after = Math.round((net * (item.refundedQuantity + requested)) / item.quantity);
    const amountCents = after - before;
    refundTotal += amountCents;
    lines.push({ saleItemId: item.id, quantity: requested, amountCents });
  }

  return { totalCents: refundTotal, lines };
}
