import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  History,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { Product, StockMovement, StoreSettings } from '../types';
import { api, withQuery } from '../lib/api';
import { cn, dateTime, money, moneyExact } from '../lib/format';
import { getExpiryStatus } from '../lib/dynamicPricing';
import { Badge, Button, EmptyState, Modal, SectionHeading, Spinner } from './ui';
import { ProductThumbnail } from './ProductThumbnail';

interface InventoryViewProps {
  products: Product[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
  onAdd: () => void;
  onEdit: (product: Product) => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

type StockFilter = 'all' | 'low' | 'out' | 'expiring';

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening stock',
  sale: 'Sale',
  refund: 'Refund',
  restock: 'Restock',
  adjustment: 'Adjustment',
  credit: 'Credit sale',
};

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  settings,
  onRefresh,
  onAdd,
  onEdit,
  showToast,
}) => {
  const currency = settings.currency;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [showArchived, setShowArchived] = useState(false);

  const [restockTarget, setRestockTarget] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [restockCost, setRestockCost] = useState('');
  const [restockNote, setRestockNote] = useState('');
  const [restockBusy, setRestockBusy] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjustCount, setAdjustCount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);

  const [historyTarget, setHistoryTarget] = useState<Product | null>(null);
  const [history, setHistory] = useState<StockMovement[] | null>(null);

  const [archiving, setArchiving] = useState<string | null>(null);

  const active = products.filter((product) => !product.archived);
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(products.map((product) => product.category)))],
    [products],
  );

  const stats = useMemo(() => {
    const low = active.filter((product) => product.stock > 0 && product.stock <= product.reorderLevel).length;
    const out = active.filter((product) => product.stock === 0).length;
    const value = active.reduce((sum, product) => sum + product.costPrice * product.stock, 0);
    return { low, out, value };
  }, [active]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (!showArchived && product.archived) return false;
      if (showArchived && !product.archived) return false;
      if (category !== 'All' && product.category !== category) return false;
      if (stockFilter === 'low' && !(product.stock > 0 && product.stock <= product.reorderLevel)) return false;
      if (stockFilter === 'out' && product.stock !== 0) return false;
      if (stockFilter === 'expiring') {
        const expiry = getExpiryStatus(product);
        if (expiry.level !== 'soon' && expiry.level !== 'expired') return false;
      }
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.brand.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.barcode.toLowerCase().includes(term)
      );
    });
  }, [products, search, category, stockFilter, showArchived]);

  const openRestock = (product: Product) => {
    setRestockTarget(product);
    setRestockQty('');
    setRestockCost(String(product.costPrice));
    setRestockNote('');
  };

  const openAdjust = (product: Product) => {
    setAdjustTarget(product);
    setAdjustCount(String(product.stock));
    setAdjustNote('');
  };

  const openHistory = async (product: Product) => {
    setHistoryTarget(product);
    setHistory(null);
    try {
      const result = await api<{ movements: StockMovement[] }>(
        withQuery(`/api/products/${product.id}/movements`, { limit: 100 }),
      );
      setHistory(result.movements);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load stock history.', 'error');
      setHistoryTarget(null);
    }
  };

  const submitRestock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!restockTarget) return;
    const quantity = Number.parseInt(restockQty, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Enter the number of units received.', 'error');
      return;
    }
    setRestockBusy(true);
    try {
      await api(`/api/products/${restockTarget.id}/restock`, {
        method: 'POST',
        body: {
          quantity,
          unitCost: restockCost.trim() || undefined,
          note: restockNote.trim() || undefined,
        },
      });
      await onRefresh();
      showToast(`${quantity} unit(s) added to ${restockTarget.name}.`);
      setRestockTarget(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Restock failed.', 'error');
    } finally {
      setRestockBusy(false);
    }
  };

  const submitAdjust = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adjustTarget) return;
    const counted = Number.parseInt(adjustCount, 10);
    if (!Number.isFinite(counted) || counted < 0) {
      showToast('Enter the counted stock level.', 'error');
      return;
    }
    setAdjustBusy(true);
    try {
      await api(`/api/products/${adjustTarget.id}/adjust-stock`, {
        method: 'POST',
        body: { countedStock: counted, note: adjustNote.trim() || undefined },
      });
      await onRefresh();
      showToast(`Stock count updated for ${adjustTarget.name}.`);
      setAdjustTarget(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Stock adjustment failed.', 'error');
    } finally {
      setAdjustBusy(false);
    }
  };

  const toggleArchive = async (product: Product) => {
    setArchiving(product.id);
    try {
      await api(`/api/products/${product.id}/archive`, {
        method: 'POST',
        body: { archived: !product.archived },
      });
      await onRefresh();
      showToast(product.archived ? `${product.name} restored.` : `${product.name} archived.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the product.', 'error');
    } finally {
      setArchiving(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Inventory"
        description={`${active.length} active · ${money(stats.value, currency)} at cost · ${stats.low} low · ${stats.out} out`}
        action={
          <Button onClick={onAdd}>
            <Plus className="w-4 h-4" /> Add product
          </Button>
        }
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active products', value: String(active.length), tone: 'text-stone-900 dark:text-zinc-100' },
          { label: 'Stock value (cost)', value: money(stats.value, currency), tone: 'text-stone-900 dark:text-zinc-100' },
          { label: 'Low stock', value: String(stats.low), tone: 'text-amber-700 dark:text-amber-400' },
          { label: 'Out of stock', value: String(stats.out), tone: 'text-red-600 dark:text-red-400' },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3"
          >
            <p className="text-[11px] uppercase tracking-wider font-semibold text-stone-500 dark:text-zinc-400">
              {card.label}
            </p>
            <p className={cn('font-mono text-lg font-semibold mt-1', card.tone)}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="p-3 border-b border-stone-100 dark:border-zinc-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, brand, SKU or barcode…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none"
          >
            {categories.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-zinc-700 overflow-hidden">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'low', label: 'Low' },
                { id: 'out', label: 'Out' },
                { id: 'expiring', label: 'Expiring' },
              ] as Array<{ id: StockFilter; label: string }>
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStockFilter(option.id)}
                className={cn(
                  'px-2.5 py-2 text-xs font-medium cursor-pointer',
                  stockFilter === option.id
                    ? 'bg-rose-900 text-white'
                    : 'text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-stone-600 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              className="accent-rose-900"
            />
            <Archive className="w-3.5 h-3.5" /> Archived
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Package className="w-5 h-5" />}
            title={showArchived ? 'No archived products' : 'No products match this view'}
            description={showArchived ? 'Archived products are kept for history and receipts.' : 'Adjust the filters or add a new product.'}
            action={
              !showArchived ? (
                <Button variant="secondary" onClick={onAdd}>
                  <Plus className="w-4 h-4" /> Add product
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 dark:text-zinc-400 border-b border-stone-100 dark:border-zinc-800">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold hidden md:table-cell">Barcode / SKU</th>
                  <th className="px-3 py-2 font-semibold text-right">Stock</th>
                  <th className="px-3 py-2 font-semibold text-right hidden sm:table-cell">Cost</th>
                  <th className="px-3 py-2 font-semibold text-right">Price</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                {filtered.map((product) => {
                  const expiry = getExpiryStatus(product);
                  return (
                    <tr key={product.id} className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ProductThumbnail
                            imageUrl={product.imageUrl}
                            name={product.name}
                            category={product.category}
                            className="w-9 h-9 rounded-md"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate max-w-[220px]">{product.name}</p>
                            <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">
                              {product.category}
                              {product.brand ? ` · ${product.brand}` : ''}
                              {product.archived ? ' · Archived' : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <p className="font-mono text-[11px]">{product.barcode}</p>
                        <p className="font-mono text-[10px] text-stone-400">{product.sku}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <p className="font-mono text-sm">{product.stock}</p>
                        <div className="flex justify-end gap-1 mt-0.5">
                          {product.stock === 0 ? (
                            <Badge tone="red">Out</Badge>
                          ) : product.stock <= product.reorderLevel ? (
                            <Badge tone="amber">Low</Badge>
                          ) : null}
                          {expiry.level === 'expired' ? (
                            <Badge tone="red">Expired</Badge>
                          ) : expiry.level === 'soon' ? (
                            <Badge tone="amber">{expiry.daysLeft}d</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs hidden sm:table-cell">
                        {money(product.costPrice, currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <p className="font-mono text-sm font-semibold">{money(product.currentPrice, currency)}</p>
                        {product.currentPrice !== product.basePrice && (
                          <p className="text-[10px] text-stone-400 line-through font-mono">
                            {money(product.basePrice, currency)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => openRestock(product)}
                            disabled={product.archived}
                            className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 disabled:opacity-30 cursor-pointer"
                            title="Restock"
                            aria-label={`Restock ${product.name}`}
                          >
                            <PackagePlus className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openAdjust(product)}
                            className="p-1.5 rounded-md text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40 cursor-pointer"
                            title="Physical count"
                            aria-label={`Adjust stock for ${product.name}`}
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openHistory(product)}
                            className="p-1.5 rounded-md text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
                            title="Stock history"
                            aria-label={`History for ${product.name}`}
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(product)}
                            className="p-1.5 rounded-md text-stone-600 hover:bg-stone-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                            title="Edit"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleArchive(product)}
                            disabled={archiving === product.id}
                            className="p-1.5 rounded-md text-stone-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/40 disabled:opacity-40 cursor-pointer"
                            title={product.archived ? 'Restore' : 'Archive'}
                            aria-label={product.archived ? `Restore ${product.name}` : `Archive ${product.name}`}
                          >
                            {product.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={restockTarget !== null}
        onClose={() => setRestockTarget(null)}
        title="Restock product"
        subtitle={restockTarget ? `${restockTarget.name} · ${restockTarget.stock} in stock` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestockTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="restock-form" loading={restockBusy}>
              Add stock
            </Button>
          </>
        }
      >
        <form id="restock-form" onSubmit={(event) => void submitRestock(event)} className="space-y-3">
          <label className="block text-xs font-medium">
            Units received
            <input
              type="number"
              min={1}
              value={restockQty}
              onChange={(event) => setRestockQty(event.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Unit cost ({currency}) — optional
            <input
              type="number"
              min={0}
              step="0.01"
              value={restockCost}
              onChange={(event) => setRestockCost(event.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Note
            <input
              type="text"
              value={restockNote}
              onChange={(event) => setRestockNote(event.target.value)}
              placeholder="Supplier, invoice number…"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
            />
          </label>
          {restockTarget && restockQty && Number.parseInt(restockQty, 10) > 0 && (
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              New stock level: {restockTarget.stock + Number.parseInt(restockQty, 10)}
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={adjustTarget !== null}
        onClose={() => setAdjustTarget(null)}
        title="Stock count adjustment"
        subtitle={adjustTarget ? `${adjustTarget.name} · system says ${adjustTarget.stock}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="adjust-form" loading={adjustBusy}>
              Save count
            </Button>
          </>
        }
      >
        <form id="adjust-form" onSubmit={(event) => void submitAdjust(event)} className="space-y-3">
          <label className="block text-xs font-medium">
            Counted units on shelf
            <input
              type="number"
              min={0}
              value={adjustCount}
              onChange={(event) => setAdjustCount(event.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-600/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Reason
            <input
              type="text"
              value={adjustNote}
              onChange={(event) => setAdjustNote(event.target.value)}
              placeholder="Damaged, expired, recount…"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30"
            />
          </label>
          {adjustTarget && adjustCount && (
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              Adjustment:{' '}
              <span className="font-mono font-semibold">
                {Number.parseInt(adjustCount, 10) - adjustTarget.stock >= 0 ? '+' : ''}
                {Number.parseInt(adjustCount, 10) - adjustTarget.stock}
              </span>
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={historyTarget !== null}
        onClose={() => {
          setHistoryTarget(null);
          setHistory(null);
        }}
        title="Stock history"
        subtitle={historyTarget?.name}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setHistoryTarget(null)}>
            Close
          </Button>
        }
      >
        {history === null ? (
          <Spinner label="Loading stock movements…" className="py-8" />
        ) : history.length === 0 ? (
          <EmptyState title="No stock movements yet" icon={<History className="w-5 h-5" />} />
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-zinc-800">
            {history.map((movement) => (
              <li key={movement.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {MOVEMENT_LABELS[movement.reason] ?? movement.reason}
                    <span className="ml-1.5 text-[11px] text-stone-500 dark:text-zinc-400">
                      {dateTime(movement.createdAt)}
                    </span>
                  </p>
                  {movement.note && (
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">{movement.note}</p>
                  )}
                </div>
                <span
                  className={cn(
                    'font-mono text-sm font-semibold shrink-0',
                    movement.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}
                >
                  {movement.delta >= 0 ? '+' : ''}
                  {movement.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
        {historyTarget && (
          <p className="mt-3 text-[11px] text-stone-400 dark:text-zinc-500">
            Current stock: {historyTarget.stock} · cost {moneyExact(historyTarget.costPrice, currency)}
          </p>
        )}
      </Modal>
    </div>
  );
};
