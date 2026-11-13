import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { PRODUCT_CATEGORIES, Product, SaleTransaction, StoreSettings } from '../types';

interface MonthlyReportsViewProps {
  transactions: SaleTransaction[];
  products: Product[];
  settings: StoreSettings;
}

export const MonthlyReportsView: React.FC<MonthlyReportsViewProps> = ({
  transactions,
  settings,
}) => {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return transactions;
    return transactions.filter((tx) => tx.createdAt.slice(0, 7) === selectedMonth);
  }, [transactions, selectedMonth]);

  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalCost = 0;
    let cashTotal = 0;
    let mpesaTotal = 0;
    let creditTotal = 0;
    let unitsSold = 0;

    const categoryMap = new Map<string, { revenue: number; units: number }>();
    for (const cat of PRODUCT_CATEGORIES) {
      categoryMap.set(cat, { revenue: 0, units: 0 });
    }

    const productMap = new Map<string, { name: string; category: string; units: number; revenue: number }>();
    const dailyMap = new Map<string, number>();

    for (const tx of monthTransactions) {
      totalRevenue += tx.totalAmount;
      if (tx.paymentMode === 'Cash') cashTotal += tx.totalAmount;
      if (tx.paymentMode === 'Mpesa') mpesaTotal += tx.totalAmount;
      if (tx.paymentMode === 'Credit') creditTotal += tx.totalAmount;

      const day = tx.createdAt.slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + tx.totalAmount);

      for (const item of tx.items) {
        unitsSold += item.quantity;
        totalCost += item.costPrice * item.quantity;

        const catEntry = categoryMap.get(item.category) ?? { revenue: 0, units: 0 };
        catEntry.revenue += item.unitPrice * item.quantity;
        catEntry.units += item.quantity;
        categoryMap.set(item.category, catEntry);

        const pEntry = productMap.get(item.productId) ?? {
          name: item.productName,
          category: item.category,
          units: 0,
          revenue: 0,
        };
        pEntry.units += item.quantity;
        pEntry.revenue += item.unitPrice * item.quantity;
        productMap.set(item.productId, pEntry);
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

    const dailySeries = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    const categoryRows = Array.from(categoryMap.entries())
      .map(([category, val]) => ({ category, ...val }))
      .filter((r) => r.units > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const topProducts = Array.from(productMap.values()).sort((a, b) => b.units - a.units);

    return {
      totalRevenue,
      grossProfit,
      marginPct,
      cashTotal,
      mpesaTotal,
      creditTotal,
      unitsSold,
      dailySeries,
      categoryRows,
      topProducts,
    };
  }, [monthTransactions]);

  const maxDaily = Math.max(1, ...metrics.dailySeries.map((d) => d.amount));

  const handleExportCsv = () => {
    const header = ['Receipt', 'Date', 'Payment Mode', 'M-Pesa Code', 'Items', 'Total'];
    const rows = monthTransactions.map((tx) => [
      tx.receiptNo,
      tx.createdAt.slice(0, 16).replace('T', ' '),
      tx.paymentMode,
      tx.mpesaDetails?.transactionCode ?? '',
      `"${tx.items.map((i) => `${i.quantity}x ${i.productName}`).join('; ')}"`,
      String(tx.totalAmount),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `whispers-cosmetics-report-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-stone-600 dark:text-zinc-400">
            Reporting Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-800 dark:text-zinc-200 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Monthly Report</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Monthly Revenue</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {metrics.totalRevenue.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
            {monthTransactions.length} receipts · {metrics.unitsSold} units
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Gross Profit</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-emerald-700 dark:text-emerald-400">
            {settings.currency} {metrics.grossProfit.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
            {metrics.marginPct}% average margin
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">M-Pesa Collections</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {metrics.mpesaTotal.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
            {metrics.totalRevenue > 0
              ? Math.round((metrics.mpesaTotal / metrics.totalRevenue) * 100)
              : 0}
            % of monthly sales
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Cash &amp; Credit Split</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {metrics.cashTotal.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
            Credit issued: {settings.currency} {metrics.creditTotal.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Daily Performance Chart + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-4">
            Daily Sales Performance ({selectedMonth})
          </h2>
          {metrics.dailySeries.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-zinc-400 py-12 text-center">
              No sales recorded in {selectedMonth}.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="h-44 flex items-end gap-3 pt-4 border-b border-stone-200 dark:border-zinc-800 pb-2">
                {metrics.dailySeries.map((day) => {
                  const pct = Math.max(8, Math.round((day.amount / maxDaily) * 100));
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-mono-num text-stone-500 dark:text-zinc-400 truncate">
                        {day.amount.toLocaleString()}
                      </span>
                      <div className="w-full max-w-[40px] h-28 flex items-end">
                        <div
                          style={{ height: `${pct}%` }}
                          className="w-full rounded-t-md bg-rose-900/85 dark:bg-rose-600 transition-all"
                        />
                      </div>
                      <span className="text-[11px] font-mono-num text-stone-500 dark:text-zinc-400">
                        {day.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-4">
            Category Performance
          </h2>
          {metrics.categoryRows.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-zinc-400 py-10 text-center">
              No category data for this period.
            </p>
          ) : (
            <div className="space-y-3">
              {metrics.categoryRows.map((row) => {
                const share =
                  metrics.totalRevenue > 0
                    ? Math.round((row.revenue / metrics.totalRevenue) * 100)
                    : 0;
                return (
                  <div key={row.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-stone-800 dark:text-zinc-200">
                        {row.category}
                      </span>
                      <span className="font-mono-num text-stone-600 dark:text-zinc-400">
                        {row.units} units · {settings.currency} {row.revenue.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        style={{ width: `${share}%` }}
                        className="h-full bg-rose-900 dark:bg-rose-600 rounded-full"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Top Products & Transaction Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-4">
            Best-Selling Products
          </h2>
          <div className="divide-y divide-stone-100 dark:divide-zinc-800 text-xs">
            {metrics.topProducts.map((p, idx) => (
              <div key={idx} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900 dark:text-zinc-100 truncate">{p.name}</p>
                  <p className="text-stone-500 dark:text-zinc-400">{p.category}</p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="font-semibold text-stone-900 dark:text-zinc-100">{p.units} sold</p>
                  <p className="text-stone-500 dark:text-zinc-400">
                    {settings.currency} {p.revenue.toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-4">
            Transaction &amp; M-Pesa Reconciliation Log
          </h2>
          <div className="divide-y divide-stone-100 dark:divide-zinc-800 text-xs max-h-80 overflow-y-auto pr-1">
            {monthTransactions.map((tx) => (
              <div key={tx.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold font-mono-num text-stone-900 dark:text-zinc-100">
                    {tx.receiptNo} · {tx.paymentMode}
                  </span>
                  <span className="font-semibold font-mono-num text-stone-900 dark:text-zinc-100">
                    {settings.currency} {tx.totalAmount.toLocaleString()}
                  </span>
                </div>
                <p className="text-stone-500 dark:text-zinc-400">
                  {new Date(tx.createdAt).toLocaleString()}
                </p>
                {tx.mpesaDetails?.rawMessage && (
                  <p className="text-[11px] bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-300 rounded-md px-2.5 py-1.5 border border-emerald-200/70 dark:border-emerald-900/50">
                    M-Pesa SMS: {tx.mpesaDetails.rawMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
