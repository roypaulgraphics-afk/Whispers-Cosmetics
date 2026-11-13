import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Flame,
  PackagePlus,
  TrendingUp,
} from 'lucide-react';
import { CreditRecord, Product, SaleTransaction, StoreSettings } from '../types';
import {
  computeCreditStatus,
  computeDynamicRecommendation,
  getExpiryStatus,
} from '../lib/dynamicPricing';
import { ProductThumbnail } from './ProductThumbnail';

interface OverviewViewProps {
  products: Product[];
  transactions: SaleTransaction[];
  credits: CreditRecord[];
  settings: StoreSettings;
  onNavigate: (tab: 'pos' | 'inventory' | 'add-product' | 'credits' | 'reports') => void;
  onApplyDynamicPrice: (productId: string, newPrice: number) => Promise<void>;
  onQuickRestock: (productId: string, addQty: number) => Promise<void>;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  products,
  transactions,
  credits,
  settings,
  onNavigate,
  onApplyDynamicPrice,
  onQuickRestock,
}) => {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayTransactions = transactions.filter((tx) => tx.createdAt.slice(0, 10) === todayKey);

  const todayRevenue = todayTransactions.reduce((sum, tx) => sum + tx.totalAmount, 0);
  const todayCash = todayTransactions
    .filter((tx) => tx.paymentMode === 'Cash')
    .reduce((sum, tx) => sum + tx.totalAmount, 0);
  const todayMpesa = todayTransactions
    .filter((tx) => tx.paymentMode === 'Mpesa')
    .reduce((sum, tx) => sum + tx.totalAmount, 0);

  const lowStockItems = products.filter((p) => p.stock <= p.reorderLevel);
  const expiryAlerts = products.filter((p) => {
    const exp = getExpiryStatus(p);
    return exp.level === 'soon' || exp.level === 'expired';
  });

  const outstandingCredits = credits.filter((c) => computeCreditStatus(c) !== 'Paid');
  const totalCreditOwed = outstandingCredits.reduce(
    (sum, c) => sum + Math.max(0, c.totalAmount - c.amountPaid),
    0,
  );

  // Daily popular products (rank by today's units, falling back to 7-day volume)
  const productSalesMap = new Map<
    string,
    { product: Product; todayUnits: number; totalUnits: number; revenueToday: number }
  >();
  for (const p of products) {
    productSalesMap.set(p.id, { product: p, todayUnits: 0, totalUnits: 0, revenueToday: 0 });
  }
  for (const tx of transactions) {
    const isToday = tx.createdAt.slice(0, 10) === todayKey;
    for (const item of tx.items) {
      const entry = productSalesMap.get(item.productId);
      if (entry) {
        entry.totalUnits += item.quantity;
        if (isToday) {
          entry.todayUnits += item.quantity;
          entry.revenueToday += item.quantity * item.unitPrice;
        }
      }
    }
  }

  const popularProducts = Array.from(productSalesMap.values())
    .sort((a, b) => b.todayUnits - a.todayUnits || b.totalUnits - a.totalUnits)
    .slice(0, 5);

  const dynamicSuggestions = products
    .map((p) => ({ product: p, rec: computeDynamicRecommendation(p, transactions) }))
    .filter((item) => item.rec.needsAdjustment)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Today&apos;s Revenue</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {todayRevenue.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400 tabular-nums">
            Cash {settings.currency} {todayCash.toLocaleString()} · M-Pesa {settings.currency}{' '}
            {todayMpesa.toLocaleString()}
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Reorder Alerts</p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono-num ${
              lowStockItems.length > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {lowStockItems.length} items
          </p>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400">
            At or below reorder threshold
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Perishable Watch</p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono-num ${
              expiryAlerts.length > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {expiryAlerts.length} items
          </p>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400">
            Expired or expiring within 30 days
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">
            Credit &amp; Pending Balance
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {totalCreditOwed.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400">
            {outstandingCredits.length} active creditor accounts
          </p>
        </div>
      </div>

      {/* Main 2-column operational panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Daily Popular Products */}
        <section className="lg:col-span-7 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-900 dark:text-rose-400" />
                <span>Popular Products Today</span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                Ranked by daily unit velocity across Cash, M-Pesa, and Credit sales
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1 text-xs font-medium text-rose-900 dark:text-rose-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              <span>Full Report</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-stone-100 dark:divide-zinc-800">
            {popularProducts.map(({ product, todayUnits, totalUnits, revenueToday }, idx) => (
              <div key={product.id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3.5">
                <span className="w-5 text-xs font-mono-num text-stone-400 dark:text-zinc-500 shrink-0">
                  0{idx + 1}
                </span>
                <ProductThumbnail
                  imageUrl={product.imageUrl}
                  name={product.name}
                  category={product.category}
                  className="w-11 h-11 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                    {product.name}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    {product.category} · {product.stock} in stock
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold font-mono-num text-stone-900 dark:text-zinc-100">
                    {todayUnits} sold today
                  </p>
                  <p className="text-xs font-mono-num text-stone-500 dark:text-zinc-400">
                    {revenueToday > 0
                      ? `${settings.currency} ${revenueToday.toLocaleString()}`
                      : `${totalUnits} this week`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Dynamic Price Recommendations */}
        <section className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-900 dark:text-rose-400" />
                <span>Dynamic Price Adjustments</span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                Real-time suggestions based on demand velocity &amp; expiry
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-rose-900 dark:text-rose-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Manage All
            </button>
          </div>

          {dynamicSuggestions.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-stone-700 dark:text-zinc-300">
                All prices aligned with demand
              </p>
              <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                No urgent price adjustments detected right now.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-zinc-800">
              {dynamicSuggestions.map(({ product, rec }) => (
                <div key={product.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-zinc-400">{rec.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onApplyDynamicPrice(product.id, rec.suggestedPrice)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Apply {settings.currency} {rec.suggestedPrice.toLocaleString()}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono-num text-stone-500 dark:text-zinc-400">
                    <span>
                      Now: {settings.currency} {product.currentPrice.toLocaleString()}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        rec.deltaPercent >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {rec.deltaPercent >= 0 ? `+${rec.deltaPercent}%` : `${rec.deltaPercent}%`} ({rec.demandTier})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Bottom Actionable Alerts: Low Stock + Perishables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Reorder Stock Alerts</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 cursor-pointer"
            >
              View Inventory
            </button>
          </div>
          {lowStockItems.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-zinc-400 py-4">
              Every product is above its reorder threshold.
            </p>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-zinc-800">
              {lowStockItems.map((item) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
                      {item.stock} left · Reorder at {item.reorderLevel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onQuickRestock(item.id, 10)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-800 dark:text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    <span>+10 Restock</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span>Perishable Expiration Watch</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 cursor-pointer"
            >
              Manage Expiry
            </button>
          </div>
          {expiryAlerts.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-zinc-400 py-4">
              No expired or near-expiry perishable items.
            </p>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-zinc-800">
              {expiryAlerts.map((item) => {
                const exp = getExpiryStatus(item);
                return (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-zinc-400">
                        {item.category} · Expiry {item.expiryDate}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                        exp.level === 'expired'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {exp.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
