import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit3,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  Product,
  ProductCategory,
  SaleTransaction,
  StoreSettings,
} from '../types';
import { computeDynamicRecommendation, getExpiryStatus } from '../lib/dynamicPricing';
import { ProductThumbnail } from './ProductThumbnail';
import { ProductFormView } from './ProductFormView';

interface InventoryViewProps {
  products: Product[];
  transactions: SaleTransaction[];
  settings: StoreSettings;
  onUpdateProduct: (id: string, data: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onGoToAddProduct: () => void;
}

type AlertFilter = 'all' | 'low_stock' | 'expiring' | 'dynamic';

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  transactions,
  settings,
  onUpdateProduct,
  onDeleteProduct,
  onGoToAddProduct,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'All'>('All');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const enrichedProducts = useMemo(() => {
    return products.map((p) => ({
      product: p,
      rec: computeDynamicRecommendation(p, transactions),
      expiry: getExpiryStatus(p),
      isLowStock: p.stock <= p.reorderLevel,
    }));
  }, [products, transactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedProducts.filter(({ product, rec, expiry, isLowStock }) => {
      if (categoryFilter !== 'All' && product.category !== categoryFilter) return false;
      if (alertFilter === 'low_stock' && !isLowStock) return false;
      if (alertFilter === 'expiring' && expiry.level !== 'soon' && expiry.level !== 'expired')
        return false;
      if (alertFilter === 'dynamic' && !rec.needsAdjustment) return false;

      if (q) {
        const hit =
          product.name.toLowerCase().includes(q) ||
          product.brand.toLowerCase().includes(q) ||
          product.category.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [enrichedProducts, categoryFilter, alertFilter, search]);

  const applyAllDynamic = async () => {
    const targets = enrichedProducts.filter((e) => e.rec.needsAdjustment);
    for (const t of targets) {
      await onUpdateProduct(t.product.id, { currentPrice: t.rec.suggestedPrice });
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by product name, brand, or category..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ProductCategory | 'All')}
            className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-800 dark:text-zinc-200"
          >
            <option value="All">All Categories ({products.length})</option>
            {PRODUCT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {enrichedProducts.some((e) => e.rec.needsAdjustment) && (
            <button
              type="button"
              onClick={() => void applyAllDynamic()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs font-medium text-rose-900 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Sync All Dynamic Prices</span>
            </button>
          )}
          <button
            type="button"
            onClick={onGoToAddProduct}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New Listing</span>
          </button>
        </div>
      </div>

      {/* Alert Filter Segmented Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: 'all', label: 'All Stock' },
            { id: 'low_stock', label: 'Reorder Alerts' },
            { id: 'expiring', label: 'Expiry Watch' },
            { id: 'dynamic', label: 'Price Suggestions' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAlertFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              alertFilter === tab.id
                ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inventory Table */}
      <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200 dark:border-zinc-800 text-[11px] font-semibold text-stone-500 dark:text-zinc-400 bg-stone-50/80 dark:bg-zinc-950/40">
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Stock / Reorder</th>
                <th className="py-3 px-4">Perishable / Expiry</th>
                <th className="py-3 px-4 text-right">Selling Price</th>
                <th className="py-3 px-4">Dynamic Demand</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-stone-500 dark:text-zinc-400">
                    No inventory items match the selected filter.
                  </td>
                </tr>
              ) : (
                filtered.map(({ product, rec, expiry, isLowStock }) => (
                  <tr
                    key={product.id}
                    className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 min-w-[210px]">
                        <ProductThumbnail
                          imageUrl={product.imageUrl}
                          name={product.name}
                          category={product.category}
                          className="w-10 h-10 rounded-lg"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900 dark:text-zinc-100 truncate max-w-[230px]">
                            {product.name}
                          </p>
                          <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                            {product.brand}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                      {product.category}
                    </td>

                    <td className="py-3 px-4 text-right font-mono-num whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span
                          className={`font-semibold ${
                            product.stock === 0
                              ? 'text-red-600 dark:text-red-400'
                              : isLowStock
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-stone-900 dark:text-zinc-100'
                          }`}
                        >
                          {product.stock} units
                        </span>
                        <span className="text-[11px] text-stone-400 dark:text-zinc-500 flex items-center gap-1">
                          {isLowStock && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                          Min {product.reorderLevel}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {product.isPerishable ? (
                        <div>
                          <p
                            className={`font-medium ${
                              expiry.level === 'expired'
                                ? 'text-red-600 dark:text-red-400'
                                : expiry.level === 'soon'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {expiry.label}
                          </p>
                          <p className="text-[11px] font-mono-num text-stone-400 dark:text-zinc-500">
                            {product.expiryDate}
                          </p>
                        </div>
                      ) : (
                        <span className="text-stone-400 dark:text-zinc-500">Non-perishable</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-mono-num whitespace-nowrap">
                      <p className="font-semibold text-stone-900 dark:text-zinc-100">
                        {settings.currency} {product.currentPrice.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-stone-400 dark:text-zinc-500">
                        Base {product.basePrice.toLocaleString()} · Cost {product.costPrice.toLocaleString()}
                      </p>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <p className="font-medium text-stone-700 dark:text-zinc-300">
                          {rec.demandTier} ({rec.unitsSold7d} sold / 7d)
                        </p>
                        {rec.needsAdjustment ? (
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateProduct(product.id, { currentPrice: rec.suggestedPrice })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-900 dark:text-rose-400 hover:underline cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>
                              Adjust to {settings.currency} {rec.suggestedPrice.toLocaleString()} (
                              {rec.deltaPercent >= 0 ? `+${rec.deltaPercent}%` : `${rec.deltaPercent}%`})
                            </span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-stone-400 dark:text-zinc-500">
                            Price optimal
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateProduct(product.id, { stock: product.stock + 5 })
                          }
                          title="Quick +5 Restock"
                          className="px-2 py-1 rounded-md border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800 font-mono-num text-[11px] font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
                        >
                          +5
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingProduct(product)}
                          title="Edit product & pricing"
                          className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteId === product.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              void onDeleteProduct(product.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-1 rounded-md bg-red-600 text-white text-[11px] font-medium cursor-pointer"
                          >
                            Confirm
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(product.id)}
                            title="Delete product"
                            className="p-1.5 rounded-md text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 p-6 my-8 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">
                  Edit Goods &amp; Price Point
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Update inventory details, product photo, expiry date, or dynamic pricing rules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-2 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-stone-200/60 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ProductFormView
              initialProduct={editingProduct}
              settings={settings}
              submitLabel="Save Changes"
              onCancel={() => setEditingProduct(null)}
              onSubmit={async (data) => {
                await onUpdateProduct(editingProduct.id, data);
                setEditingProduct(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
