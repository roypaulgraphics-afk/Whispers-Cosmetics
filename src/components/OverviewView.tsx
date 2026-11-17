import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  Package,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { BootstrapData } from '../types';
import type { DynamicPriceRecommendation } from '../lib/dynamicPricing';
import { api } from '../lib/api';
import { Badge, EmptyState, SectionHeading, Spinner, StatCard } from './ui';
import { cn, dateOnly, money, percent, timeOnly } from '../lib/format';

interface OverviewViewProps {
  data: BootstrapData;
  onNavigate: (route: string) => void;
  onRefresh: () => Promise<void>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const OverviewView: React.FC<OverviewViewProps> = ({ data, onNavigate, onRefresh, showToast }) => {
  const { overview, settings, meta } = data;
  const currency = settings.currency;
  const [recommendations, setRecommendations] = useState<DynamicPriceRecommendation[]>([]);
  const [loadingPricing, setLoadingPricing] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  const loadPricing = useCallback(async () => {
    setLoadingPricing(true);
    try {
      const result = await api<{ recommendations: DynamicPriceRecommendation[] }>('/api/pricing');
      setRecommendations(result.recommendations);
    } catch {
      setRecommendations([]);
    } finally {
      setLoadingPricing(false);
    }
  }, []);

  useEffect(() => {
    void loadPricing();
  }, [loadPricing]);

  const dailyMax = useMemo(
    () => Math.max(1, ...overview.daily.map((point) => Math.max(point.sales, point.refunds))),
    [overview.daily],
  );

  const productNames = useMemo(
    () => new Map(data.products.map((product) => [product.id, product.name])),
    [data.products],
  );

  const applyRecommendation = async (rec: DynamicPriceRecommendation) => {
    setApplying(rec.productId);
    try {
      await api(`/api/products/${rec.productId}`, {
        method: 'PATCH',
        body: { currentPrice: rec.suggestedPrice },
      });
      await onRefresh();
      await loadPricing();
      showToast(`Price updated to ${money(rec.suggestedPrice, currency)}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update price.', 'error');
    } finally {
      setApplying(null);
    }
  };

  const todayChange =
    overview.yesterday.netSales > 0
      ? ((overview.today.netSales - overview.yesterday.netSales) / overview.yesterday.netSales) * 100
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-stone-400 dark:text-zinc-500">
            {meta.today ? dateOnly(meta.today) : 'Today'} · {settings.storeName}
          </p>
          <h2 className="font-display text-3xl font-semibold mt-1">Store overview</h2>
          <p className="text-sm text-stone-500 dark:text-zinc-400 mt-1">
            Today at a glance, plus what needs attention in the store.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('pos')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-900 hover:bg-rose-950 text-white text-sm font-semibold shadow-sm cursor-pointer"
        >
          <ShoppingCart className="w-4 h-4" /> Open register
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="Today's sales"
          value={money(overview.today.netSales, currency)}
          sub={
            todayChange === null
              ? `${overview.today.salesCount} transaction(s)`
              : `${percent(todayChange)} vs yesterday`
          }
          icon={<Wallet className="w-4 h-4" />}
          accent="rose"
        />
        <StatCard
          label="Transactions"
          value={String(overview.today.salesCount)}
          sub={`Avg ${money(overview.today.averageSale, currency)}`}
          icon={<ShoppingCart className="w-4 h-4" />}
          accent="sky"
        />
        <StatCard
          label="Gross profit today"
          value={money(overview.today.grossProfit, currency)}
          sub={`After ${money(overview.today.refunds, currency)} refunds`}
          icon={<TrendingUp className="w-4 h-4" />}
          accent="emerald"
        />
        <StatCard
          label="Credit outstanding"
          value={money(overview.outstandingCredit, currency)}
          sub={`${overview.activeCredits} open credit account(s)`}
          icon={<CreditCard className="w-4 h-4" />}
          accent="amber"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading
            title="Last 7 days"
            description={`${money(overview.last7.netSales, currency)} net · ${overview.last7.salesCount} sales`}
            action={
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-rose-900 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
              >
                Full reports <ArrowRight className="w-3.5 h-3.5" />
              </button>
            }
          />
          <div className="h-44 flex items-end gap-2 sm:gap-3">
            {overview.daily.map((point) => {
              const day = WEEKDAYS[new Date(`${point.date}T12:00:00Z`).getUTCDay()];
              const height = Math.max(4, Math.round((point.sales / dailyMax) * 140));
              return (
                <div key={point.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                  <div className="w-full h-36 flex items-end justify-center">
                    <div
                      className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-rose-900 to-rose-700/80 dark:from-rose-800 dark:to-rose-600/80 relative group"
                      style={{ height }}
                      title={`${money(point.sales, currency)} · ${point.transactions} sale(s)`}
                    >
                      {point.refunds > 0 && (
                        <span
                          className="absolute bottom-0 inset-x-0 bg-amber-500/80 rounded-t-sm"
                          style={{ height: Math.max(2, Math.round((point.refunds / dailyMax) * 140)) }}
                        />
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-stone-500 dark:text-zinc-400">{day}</span>
                  <span className="text-[9px] font-mono text-stone-400 dark:text-zinc-500 truncate max-w-full">
                    {point.sales > 0 ? Math.round(point.sales).toLocaleString() : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-stone-100 dark:border-zinc-800 text-[11px] text-stone-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-800" /> Sales
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Refunds
            </span>
            <span className="ml-auto">30-day revenue {money(overview.last30.netSales, currency)}</span>
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading title="Payment mix" description="Last 30 days" />
          <div className="space-y-4">
            {overview.paymentMix.map((entry) => {
              const total = overview.paymentMix.reduce((sum, item) => sum + item.amount, 0);
              const share = total > 0 ? (entry.amount / total) * 100 : 0;
              const colors =
                entry.mode === 'Cash'
                  ? 'bg-emerald-700'
                  : entry.mode === 'Mpesa'
                    ? 'bg-sky-700'
                    : 'bg-amber-600';
              return (
                <div key={entry.mode}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium">{entry.mode}</span>
                    <span className="font-mono text-stone-500 dark:text-zinc-400">
                      {money(entry.amount, currency)} · {Math.round(share)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full rounded-full', colors)} style={{ width: `${Math.max(2, share)}%` }} />
                  </div>
                  <p className="text-[10px] text-stone-400 dark:text-zinc-500 mt-1">{entry.count} sale(s)</p>
                </div>
              );
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-stone-100 dark:border-zinc-800 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-stone-500 dark:text-zinc-400">Inventory value</p>
              <p className="font-mono font-semibold mt-0.5">{money(overview.inventoryValue, currency)}</p>
            </div>
            <div>
              <p className="text-stone-500 dark:text-zinc-400">Active products</p>
              <p className="font-mono font-semibold mt-0.5">{overview.totalProducts}</p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading
            title="Low stock"
            description={`${overview.lowStock.length} item(s) at or below reorder level`}
            action={
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-rose-900 dark:text-rose-400 cursor-pointer"
              >
                Manage
              </button>
            }
          />
          {overview.lowStock.length === 0 ? (
            <EmptyState icon={<Package className="w-5 h-5" />} title="Stock levels look healthy" />
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-zinc-800">
              {overview.lowStock.slice(0, 6).map((product) => (
                <li key={product.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                      {product.category} · reorder at {product.reorderLevel}
                    </p>
                  </div>
                  <Badge tone={product.stock === 0 ? 'red' : 'amber'}>{product.stock} left</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading
            title="Expiring soon"
            description="Perishable products within 30 days"
            action={
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-rose-900 dark:text-rose-400 cursor-pointer"
              >
                Inspect
              </button>
            }
          />
          {overview.expiring.length === 0 ? (
            <EmptyState icon={<CalendarClock className="w-5 h-5" />} title="Nothing expiring soon" />
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-zinc-800">
              {overview.expiring.slice(0, 6).map((product) => (
                <li key={product.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                      Expiry {product.expiryDate ? dateOnly(product.expiryDate) : '—'}
                    </p>
                  </div>
                  <Badge tone="amber">{product.stock} in stock</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading title="Price recommendations" description="Based on the last 7 days of sales" />
          {loadingPricing ? (
            <Spinner label="Checking demand…" className="py-8" />
          ) : recommendations.length === 0 ? (
            <EmptyState
              icon={<CircleDollarSign className="w-5 h-5" />}
              title="Prices are well balanced"
              description="No adjustments are recommended right now."
            />
          ) : (
            <ul className="space-y-2.5">
              {recommendations.slice(0, 5).map((rec) => (
                <li
                  key={rec.productId}
                  className="rounded-lg border border-stone-200 dark:border-zinc-800 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {productNames.get(rec.productId) ?? 'Unknown product'}
                    </p>
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400 line-clamp-2">{rec.reason}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        tone={
                          rec.demandTier === 'High Demand'
                            ? 'green'
                            : rec.demandTier === 'Near Expiry'
                              ? 'amber'
                              : rec.demandTier === 'Slow Moving'
                                ? 'red'
                                : 'neutral'
                        }
                      >
                        {rec.demandTier}
                      </Badge>
                      <span className="text-[11px] font-mono text-stone-500 dark:text-zinc-400">
                        {money(rec.suggestedPrice, currency)} ({percent(rec.deltaPercent)})
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyRecommendation(rec)}
                    disabled={applying === rec.productId}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-xs font-medium text-rose-900 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 cursor-pointer"
                  >
                    {applying === rec.productId ? 'Applying…' : 'Apply'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <SectionHeading
            title="Recent receipts"
            description="Latest sales from this register"
            action={
              <button
                type="button"
                onClick={() => onNavigate('receipts')}
                className="text-xs font-medium text-rose-900 dark:text-rose-400 cursor-pointer"
              >
                All receipts
              </button>
            }
          />
          {overview.recentSales.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="w-5 h-5" />} title="No sales yet today" />
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-zinc-800">
              {overview.recentSales.map((sale) => (
                <li key={sale.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium font-mono">{sale.receiptNo}</p>
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                      {timeOnly(sale.createdAt)} · {sale.paymentMode} · {sale.items.length} item(s)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{money(sale.totalAmount, currency)}</p>
                    {sale.status !== 'Completed' && (
                      <Badge tone={sale.status === 'Refunded' ? 'red' : 'amber'} className="mt-0.5">
                        {sale.status}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {overview.expiring.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              {overview.expiring.length} perishable item(s) need attention.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
