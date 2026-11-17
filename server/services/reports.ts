import type { DatabaseSync } from 'node:sqlite';
import type {
  DailySalesPoint,
  OverviewReport,
  PaymentMixEntry,
  ReportData,
  SalesTotals,
  TopProductRow,
} from '../../src/types';
import { get } from '../db';
import { fromCents } from '../money';
import { addDaysToDateOnly, isDateOnly, todayFor } from '../time';
import {
  computeDynamicRecommendation,
  daysUntilExpiry,
  type DynamicPriceRecommendation,
} from '../../src/lib/dynamicPricing';
import type { AppConfig } from '../config';
import { listProducts } from './products';
import { listRefunds, listSales } from './sales';

interface RangeTotalsRow {
  sales_count: number;
  gross_cents: number;
  discount_cents: number;
  cash_cents: number;
  mpesa_cents: number;
  credit_cents: number;
}

function rangeTotals(db: DatabaseSync, from: string, to: string): SalesTotals {
  const sales = get<RangeTotalsRow>(
    db,
    `SELECT
      COUNT(*) AS sales_count,
      IFNULL(SUM(total_cents), 0) AS gross_cents,
      IFNULL(SUM(discount_cents), 0) AS discount_cents,
      IFNULL(SUM(CASE WHEN payment_mode = 'Cash' THEN total_cents ELSE 0 END), 0) AS cash_cents,
      IFNULL(SUM(CASE WHEN payment_mode = 'Mpesa' THEN total_cents ELSE 0 END), 0) AS mpesa_cents,
      IFNULL(SUM(CASE WHEN payment_mode = 'Credit' THEN total_cents ELSE 0 END), 0) AS credit_cents
     FROM sales WHERE business_date BETWEEN ? AND ?`,
    from,
    to,
  );
  const refunds = get<{ refund_cents: number }>(
    db,
    'SELECT IFNULL(SUM(total_cents), 0) AS refund_cents FROM refunds WHERE business_date BETWEEN ? AND ?',
    from,
    to,
  );
  const cogs = get<{ cogs_cents: number }>(
    db,
    `SELECT IFNULL(SUM(si.cost_price_cents * (si.quantity - si.refunded_quantity)), 0) AS cogs_cents
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.business_date BETWEEN ? AND ?`,
    from,
    to,
  );

  const grossCents = Number(sales?.gross_cents ?? 0);
  const refundCents = Number(refunds?.refund_cents ?? 0);
  const cogsCents = Number(cogs?.cogs_cents ?? 0);
  const netCents = grossCents - refundCents;
  const count = Number(sales?.sales_count ?? 0);

  return {
    salesCount: count,
    grossSales: fromCents(grossCents),
    discounts: fromCents(Number(sales?.discount_cents ?? 0)),
    refunds: fromCents(refundCents),
    netSales: fromCents(netCents),
    costOfGoods: fromCents(cogsCents),
    grossProfit: fromCents(netCents - cogsCents),
    averageSale: fromCents(count > 0 ? Math.round(grossCents / count) : 0),
    cashSales: fromCents(Number(sales?.cash_cents ?? 0)),
    mpesaSales: fromCents(Number(sales?.mpesa_cents ?? 0)),
    creditSales: fromCents(Number(sales?.credit_cents ?? 0)),
  };
}

function dailySeries(db: DatabaseSync, from: string, to: string): DailySalesPoint[] {
  const sales = new Map(
    db
      .prepare(
        `SELECT business_date AS date, SUM(total_cents) AS sales, COUNT(*) AS transactions
         FROM sales WHERE business_date BETWEEN ? AND ? GROUP BY business_date`,
      )
      .all(from, to)
      .map((row) => {
        const typed = row as { date: string; sales: number; transactions: number };
        return [typed.date, typed] as const;
      }),
  );
  const refunds = new Map(
    db
      .prepare(
        `SELECT business_date AS date, SUM(total_cents) AS refunds
         FROM refunds WHERE business_date BETWEEN ? AND ? GROUP BY business_date`,
      )
      .all(from, to)
      .map((row) => {
        const typed = row as { date: string; refunds: number };
        return [typed.date, typed.refunds] as const;
      }),
  );

  const points: DailySalesPoint[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    const sale = sales.get(cursor);
    points.push({
      date: cursor,
      sales: fromCents(Number(sale?.sales ?? 0)),
      refunds: fromCents(Number(refunds.get(cursor) ?? 0)),
      transactions: Number(sale?.transactions ?? 0),
    });
    cursor = addDaysToDateOnly(cursor, 1);
    guard += 1;
  }
  return points;
}

function paymentMix(db: DatabaseSync, from: string, to: string): PaymentMixEntry[] {
  const rows = db
    .prepare(
      `SELECT payment_mode AS mode, COUNT(*) AS count, SUM(total_cents) AS amount
       FROM sales WHERE business_date BETWEEN ? AND ? GROUP BY payment_mode`,
    )
    .all(from, to) as Array<{ mode: 'Cash' | 'Mpesa' | 'Credit'; count: number; amount: number }>;
  const modes: Array<'Cash' | 'Mpesa' | 'Credit'> = ['Cash', 'Mpesa', 'Credit'];
  return modes.map((mode) => {
    const row = rows.find((entry) => entry.mode === mode);
    return {
      mode,
      amount: fromCents(Number(row?.amount ?? 0)),
      count: Number(row?.count ?? 0),
    };
  });
}

function topProducts(db: DatabaseSync, from: string, to: string): TopProductRow[] {
  const rows = db
    .prepare(
      `SELECT si.product_id, si.product_name AS name,
        SUM(si.quantity - si.refunded_quantity) AS quantity,
        SUM((si.quantity - si.refunded_quantity) * si.unit_price_cents) AS revenue_cents
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.business_date BETWEEN ? AND ?
       GROUP BY si.product_id, si.product_name
       HAVING quantity > 0
       ORDER BY revenue_cents DESC LIMIT 8`,
    )
    .all(from, to) as Array<{
    product_id: string;
    name: string;
    quantity: number;
    revenue_cents: number;
  }>;
  return rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    quantity: Number(row.quantity),
    revenue: fromCents(Number(row.revenue_cents)),
  }));
}

function creditOutstanding(db: DatabaseSync, today?: string): {
  outstanding: number;
  active: number;
  overdue: number;
} {
  const row = get<{ outstanding_cents: number; active: number }>(
    db,
    `SELECT IFNULL(SUM(MAX(total_cents - amount_paid_cents, 0)), 0) AS outstanding_cents,
      COUNT(*) AS active
     FROM credits WHERE total_cents > amount_paid_cents`,
  );
  let overdueCents = 0;
  if (today) {
    const overdue = get<{ overdue_cents: number }>(
      db,
      `SELECT IFNULL(SUM(total_cents - amount_paid_cents), 0) AS overdue_cents
       FROM credits WHERE total_cents > amount_paid_cents AND due_date < ?`,
      today,
    );
    overdueCents = Number(overdue?.overdue_cents ?? 0);
  }
  return {
    outstanding: fromCents(Number(row?.outstanding_cents ?? 0)),
    active: Number(row?.active ?? 0),
    overdue: fromCents(overdueCents),
  };
}

export function getOverview(db: DatabaseSync, config: AppConfig): OverviewReport {
  const today = todayFor(config.timezone);
  const yesterday = addDaysToDateOnly(today, -1);
  const weekStart = addDaysToDateOnly(today, -6);
  const monthStart = addDaysToDateOnly(today, -29);

  const products = listProducts(db);
  const active = products.filter((product) => !product.archived);
  const lowStock = active
    .filter((product) => product.stock <= product.reorderLevel)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 12);
  const expiring = active
    .filter((product) => product.isPerishable && product.expiryDate)
    .map((product) => ({ product, days: daysUntilExpiry(product.expiryDate) }))
    .filter((entry) => entry.days !== null && entry.days <= 30)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 12)
    .map((entry) => entry.product);

  const credit = creditOutstanding(db, today);
  const inventoryValue = active.reduce(
    (sum, product) => sum + Math.round(product.costPrice * 100) * product.stock,
    0,
  );

  return {
    today: rangeTotals(db, today, today),
    yesterday: rangeTotals(db, yesterday, yesterday),
    last7: rangeTotals(db, weekStart, today),
    last30: rangeTotals(db, monthStart, today),
    paymentMix: paymentMix(db, monthStart, today),
    daily: dailySeries(db, weekStart, today),
    topProducts: topProducts(db, monthStart, today),
    lowStock,
    expiring,
    outstandingCredit: credit.outstanding,
    activeCredits: credit.active,
    customersOwing: credit.active,
    totalProducts: active.length,
    inventoryValue: fromCents(inventoryValue),
    recentSales: listSales(db, { limit: 8 }).sales,
  };
}

export function getReport(db: DatabaseSync, config: AppConfig, from: string, to: string): ReportData {
  if (!isDateOnly(from) || !isDateOnly(to)) {
    throw new Error('Invalid report date range');
  }
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const previousTo = addDaysToDateOnly(from, -1);
  const previousFrom = addDaysToDateOnly(previousTo, -(days - 1));

  const creditCollected = get<{ cents: number }>(
    db,
    'SELECT IFNULL(SUM(amount_cents), 0) AS cents FROM credit_payments WHERE business_date BETWEEN ? AND ?',
    from,
    to,
  );
  const credit = creditOutstanding(db, todayFor(config.timezone));

  return {
    from,
    to,
    totals: rangeTotals(db, from, to),
    previous: rangeTotals(db, previousFrom, previousTo),
    previousFrom,
    previousTo,
    daily: dailySeries(db, from, to),
    paymentMix: paymentMix(db, from, to),
    topProducts: topProducts(db, from, to),
    refunds: listRefunds(db, { from, to, limit: 200 }),
    creditCollected: fromCents(Number(creditCollected?.cents ?? 0)),
    overdueCredit: credit.overdue,
  };
}

export function getPricingRecommendations(
  db: DatabaseSync,
  _config: AppConfig,
): DynamicPriceRecommendation[] {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT s.id AS sale_id, s.created_at, si.product_id, si.quantity
       FROM sales s JOIN sale_items si ON si.sale_id = s.id
       WHERE s.created_at >= ? ORDER BY s.created_at ASC`,
    )
    .all(since) as Array<{
    sale_id: string;
    created_at: string;
    product_id: string;
    quantity: number;
  }>;

  const bySale = new Map<string, { createdAt: string; items: Array<{ productId: string; quantity: number }> }>();
  for (const row of rows) {
    const sale = bySale.get(row.sale_id) ?? { createdAt: row.created_at, items: [] };
    sale.items.push({ productId: row.product_id, quantity: row.quantity });
    bySale.set(row.sale_id, sale);
  }
  const history = [...bySale.values()];

  return listProducts(db)
    .filter((product) => !product.archived)
    .map((product) => computeDynamicRecommendation(product, history))
    .filter((recommendation) => recommendation.needsAdjustment)
    .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
    .slice(0, 12);
}
