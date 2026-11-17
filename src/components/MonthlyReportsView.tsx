import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import type { AppMeta, PaymentMode, ReportData, SaleTransaction, StoreSettings } from '../types';
import { api, withQuery } from '../lib/api';
import { addDays, cn, dateOnly, money, percent } from '../lib/format';
import { Badge, Button, EmptyState, SectionHeading, Spinner, StatCard } from './ui';

interface MonthlyReportsViewProps {
  settings: StoreSettings;
  meta: AppMeta;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

interface Range {
  from: string;
  to: string;
}

function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

function previousMonth(date: string): Range {
  const first = new Date(`${monthStart(date)}T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 1);
  const start = first.toISOString().slice(0, 10);
  const end = new Date(`${monthStart(date)}T00:00:00Z`);
  end.setUTCDate(0);
  return { from: start, to: end.toISOString().slice(0, 10) };
}

function presetRange(preset: Preset, today: string): Range {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: monthStart(today), to: today };
    case 'lastMonth':
      return previousMonth(today);
    default:
      return { from: addDays(today, -29), to: today };
  }
}

function change(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

const PAYMENT_COLORS: Record<PaymentMode, string> = {
  Cash: 'bg-emerald-700',
  Mpesa: 'bg-sky-700',
  Credit: 'bg-amber-600',
};

function csvEscape(value: string | number | undefined): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const MonthlyReportsView: React.FC<MonthlyReportsViewProps> = ({ settings, meta, showToast }) => {
  const currency = settings.currency;
  const [preset, setPreset] = useState<Preset>('7d');
  const [range, setRange] = useState<Range>(() => presetRange('7d', meta.today));
  const [draftFrom, setDraftFrom] = useState(range.from);
  const [draftTo, setDraftTo] = useState(range.to);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = async (next: Range) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ report: ReportData }>(
        withQuery('/api/reports', { from: next.from, to: next.to }),
      );
      setReport(result.report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(range);
  }, [range.from, range.to]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === 'custom') return;
    const nextRange = presetRange(next, meta.today);
    setRange(nextRange);
    setDraftFrom(nextRange.from);
    setDraftTo(nextRange.to);
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) {
      showToast('Choose both start and end dates.', 'error');
      return;
    }
    if (draftFrom > draftTo) {
      showToast('The start date must be before the end date.', 'error');
      return;
    }
    setPreset('custom');
    setRange({ from: draftFrom, to: draftTo });
  };

  const dailyMax = useMemo(
    () => Math.max(1, ...(report?.daily.map((point) => Math.max(point.sales, point.refunds)) ?? [1])),
    [report],
  );

  const paymentTotal = useMemo(
    () => report?.paymentMix.reduce((sum, entry) => sum + entry.amount, 0) ?? 0,
    [report],
  );

  const exportCsv = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const result = await api<{ sales: SaleTransaction[]; total: number }>(
        withQuery('/api/sales', { from: range.from, to: range.to, limit: 200 }),
      );
      const header = [
        'Receipt',
        'Business date',
        'Created at',
        'Cashier',
        'Payment',
        'Status',
        'Subtotal',
        'Discount',
        'Total',
        'M-Pesa code',
      ];
      const rows = result.sales.map((sale) => [
        sale.receiptNo,
        sale.businessDate,
        sale.createdAt,
        sale.cashier,
        sale.paymentMode,
        sale.status,
        sale.subtotalAmount,
        sale.discountAmount,
        sale.totalAmount,
        sale.mpesaDetails?.transactionCode ?? '',
      ]);
      const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `whispers-sales-${range.from}-to-${range.to}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      if (result.total > result.sales.length) {
        showToast(`CSV exported with the latest ${result.sales.length} of ${result.total} sales.`, 'info');
      } else {
        showToast('CSV exported.');
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not export sales.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const netChange = report ? change(report.totals.netSales, report.previous.netSales) : null;
  const profitChange = report ? change(report.totals.grossProfit, report.previous.grossProfit) : null;
  const countChange = report ? change(report.totals.salesCount, report.previous.salesCount) : null;

  const renderDelta = (value: number | null) => {
    if (value === null) return <span className="text-stone-400">No prior data</span>;
    const positive = value >= 0;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-medium',
          positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}
      >
        {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {percent(value)} vs previous
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Reports"
        description={`${dateOnly(range.from)} – ${dateOnly(range.to)} · ${meta.timezone}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void load(range)} disabled={loading}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
            </Button>
            <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting} disabled={!report}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7d', label: 'Last 7 days' },
              { id: '30d', label: 'Last 30 days' },
              { id: 'month', label: 'This month' },
              { id: 'lastMonth', label: 'Last month' },
            ] as Array<{ id: Preset; label: string }>
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => applyPreset(option.id)}
              className={cn(
                'px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer',
                preset === option.id
                  ? 'bg-rose-900 border-rose-900 text-white'
                  : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="date"
            value={draftFrom}
            max={draftTo || meta.today}
            onChange={(event) => setDraftFrom(event.target.value)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
          />
          <span className="text-xs text-stone-400">to</span>
          <input
            type="date"
            value={draftTo}
            min={draftFrom}
            max={meta.today}
            onChange={(event) => setDraftTo(event.target.value)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
          />
          <Button size="sm" variant="secondary" onClick={applyCustom}>
            Apply
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load(range)}>
            Retry
          </Button>
        </div>
      ) : loading && !report ? (
        <Spinner label="Building report…" className="py-24" />
      ) : report ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              label="Net sales"
              value={money(report.totals.netSales, currency)}
              sub={undefined}
              icon={<TrendingUp className="w-4 h-4" />}
              accent="rose"
            />
            <StatCard
              label="Gross profit"
              value={money(report.totals.grossProfit, currency)}
              sub={`COGS ${money(report.totals.costOfGoods, currency)}`}
              icon={<BarChart3 className="w-4 h-4" />}
              accent="emerald"
            />
            <StatCard
              label="Transactions"
              value={String(report.totals.salesCount)}
              sub={`Average ${money(report.totals.averageSale, currency)}`}
              icon={<TrendingUp className="w-4 h-4" />}
              accent="sky"
            />
            <StatCard
              label="Refunds"
              value={money(report.totals.refunds, currency)}
              sub={`Discounts ${money(report.totals.discounts, currency)}`}
              icon={<ArrowDownRight className="w-4 h-4" />}
              accent="amber"
            />
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-xs rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
            <div>
              <p className="text-stone-500 dark:text-zinc-400">Sales growth</p>
              <p className="mt-0.5">{renderDelta(netChange)}</p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-zinc-400">Profit growth</p>
              <p className="mt-0.5">{renderDelta(profitChange)}</p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-zinc-400">Traffic</p>
              <p className="mt-0.5">{renderDelta(countChange)}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <section className="lg:col-span-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <SectionHeading title="Daily sales" description="Bars show revenue, amber shows refunds" />
              <div className="h-52 flex items-end gap-1.5 overflow-x-auto pb-1">
                {report.daily.map((point) => {
                  const height = Math.max(3, Math.round((point.sales / dailyMax) * 160));
                  return (
                    <div key={point.date} className="flex-1 min-w-[18px] flex flex-col items-center gap-1">
                      <div className="h-40 w-full flex items-end justify-center">
                        <div
                          className="relative w-full max-w-8 rounded-t bg-rose-800/90"
                          style={{ height }}
                          title={`${dateOnly(point.date)} · ${money(point.sales, currency)} · ${point.transactions} sale(s)`}
                        >
                          {point.refunds > 0 && (
                            <span
                              className="absolute bottom-0 inset-x-0 bg-amber-500/90 rounded-t-sm"
                              style={{ height: Math.max(2, Math.round((point.refunds / dailyMax) * 160)) }}
                            />
                          )}
                        </div>
                      </div>
                      <span className="text-[9px] text-stone-400 whitespace-nowrap">
                        {point.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <SectionHeading title="Payment mix" description="Revenue share in range" />
              <div className="space-y-4">
                {report.paymentMix.map((entry) => {
                  const share = paymentTotal > 0 ? (entry.amount / paymentTotal) * 100 : 0;
                  return (
                    <div key={entry.mode}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-medium">{entry.mode}</span>
                        <span className="font-mono text-stone-500 dark:text-zinc-400">
                          {money(entry.amount, currency)} · {Math.round(share)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', PAYMENT_COLORS[entry.mode])}
                          style={{ width: `${Math.max(2, share)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-stone-400 mt-1">{entry.count} sale(s)</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 pt-4 border-t border-stone-100 dark:border-zinc-800 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-stone-500 dark:text-zinc-400">Credit collected</p>
                  <p className="font-mono font-semibold mt-0.5">{money(report.creditCollected, currency)}</p>
                </div>
                <div>
                  <p className="text-stone-500 dark:text-zinc-400">Overdue credit</p>
                  <p className="font-mono font-semibold mt-0.5 text-amber-700 dark:text-amber-400">
                    {money(report.overdueCredit, currency)}
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <SectionHeading title="Top products" description="By revenue in range" />
              {report.topProducts.length === 0 ? (
                <EmptyState title="No products sold in this range" icon={<BarChart3 className="w-5 h-5" />} />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                      <th className="py-1.5 font-semibold">Product</th>
                      <th className="py-1.5 font-semibold text-right">Units</th>
                      <th className="py-1.5 font-semibold text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                    {report.topProducts.slice(0, 10).map((row) => (
                      <tr key={row.productId}>
                        <td className="py-2 pr-2 truncate max-w-[200px] text-xs">{row.name}</td>
                        <td className="py-2 text-right font-mono text-xs">{row.quantity}</td>
                        <td className="py-2 text-right font-mono text-xs font-semibold">
                          {money(row.revenue, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <SectionHeading title="Refund log" description={`${report.refunds.length} refund(s) in range`} />
              {report.refunds.length === 0 ? (
                <EmptyState title="No refunds in this range" icon={<ArrowDownRight className="w-5 h-5" />} />
              ) : (
                <ul className="divide-y divide-stone-100 dark:divide-zinc-800 max-h-[340px] overflow-y-auto">
                  {report.refunds.slice(0, 20).map((refund) => (
                    <li key={refund.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">
                          <span className="font-mono">{refund.refundNo}</span> · {refund.saleReceiptNo}
                        </p>
                        <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">{refund.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-xs font-semibold">{money(refund.totalAmount, currency)}</p>
                        <Badge tone={refund.restocked ? 'green' : 'neutral'} className="mt-0.5">
                          {refund.method}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-[11px] text-stone-500 dark:text-zinc-400">
            Comparing {dateOnly(report.previousFrom)} – {dateOnly(report.previousTo)}: net{' '}
            {money(report.previous.netSales, currency)}, profit {money(report.previous.grossProfit, currency)},{' '}
            {report.previous.salesCount} transaction(s).
          </div>
        </>
      ) : null}
    </div>
  );
};
