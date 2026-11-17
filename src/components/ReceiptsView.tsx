import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  ReceiptText,
  RotateCcw,
  Search,
} from 'lucide-react';
import type {
  CreditRecord,
  PaymentMode,
  RefundRecord,
  SaleStatus,
  SaleTransaction,
  StoreSettings,
} from '../types';
import { api, withQuery } from '../lib/api';
import { computeRefundAllocation } from '../lib/refunds';
import { cn, dateOnly, dateTime, money, moneyExact, timeOnly } from '../lib/format';
import { Badge, Button, EmptyState, Modal, SectionHeading, Spinner } from './ui';
import { ReceiptModal } from './Receipt';

interface ReceiptsViewProps {
  settings: StoreSettings;
  credits: CreditRecord[];
  onRefresh: () => Promise<void>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

type RangeKey = 'today' | '7d' | '30d' | 'all';
type Tab = 'sales' | 'refunds';

const PAGE_SIZE = 25;

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function rangeFor(key: RangeKey): { from?: string; to?: string } {
  if (key === 'all') return {};
  if (key === 'today') return { from: localToday(), to: localToday() };
  if (key === '7d') return { from: daysAgo(6), to: localToday() };
  return { from: daysAgo(29), to: localToday() };
}

const STATUS_TONES: Record<SaleStatus, 'green' | 'amber' | 'red'> = {
  Completed: 'green',
  'Partially Refunded': 'amber',
  Refunded: 'red',
};

export const ReceiptsView: React.FC<ReceiptsViewProps> = ({
  settings,
  credits,
  onRefresh,
  showToast,
}) => {
  const currency = settings.currency;
  const [tab, setTab] = useState<Tab>('sales');
  const [range, setRange] = useState<RangeKey>('7d');
  const [mode, setMode] = useState<PaymentMode | 'all'>('all');
  const [status, setStatus] = useState<SaleStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);

  const [sales, setSales] = useState<SaleTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [viewSale, setViewSale] = useState<SaleTransaction | null>(null);
  const [refundSale, setRefundSale] = useState<SaleTransaction | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<'Cash' | 'Mpesa'>('Cash');
  const [refundRestock, setRefundRestock] = useState(true);
  const [refundReason, setRefundReason] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundReceipt, setRefundReceipt] = useState<{ sale: SaleTransaction; refund: RefundRecord } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setOffset(0);
  }, [tab, range, mode, status, debounced]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      const dates = rangeFor(range);
      try {
        if (tab === 'sales') {
          const result = await api<{ sales: SaleTransaction[]; total: number }>(
            withQuery('/api/sales', {
              from: dates.from,
              to: dates.to,
              mode: mode === 'all' ? undefined : mode,
              status: status === 'all' ? undefined : status,
              q: debounced || undefined,
              limit: PAGE_SIZE,
              offset,
            }),
          );
          if (cancelled) return;
          setSales(result.sales);
          setTotal(result.total);
        } else {
          const result = await api<{ refunds: RefundRecord[] }>(
            withQuery('/api/refunds', { from: dates.from, to: dates.to, limit: 200 }),
          );
          if (cancelled) return;
          setRefunds(result.refunds);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load receipts.');
          setSales([]);
          setTotal(0);
          setRefunds([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, range, mode, status, debounced, offset, reloadKey]);

  const visibleRefunds = useMemo(() => {
    const term = debounced.toLowerCase();
    if (!term) return refunds;
    return refunds.filter(
      (refund) =>
        refund.refundNo.toLowerCase().includes(term) ||
        refund.saleReceiptNo.toLowerCase().includes(term) ||
        refund.reason.toLowerCase().includes(term),
    );
  }, [refunds, debounced]);

  const creditFor = (sale: SaleTransaction | null) => {
    if (!sale) return undefined;
    return credits.find((credit) => credit.id === sale.creditRecordId || credit.saleId === sale.id);
  };

  const openRefund = (sale: SaleTransaction) => {
    setRefundSale(sale);
    setRefundQty({});
    setRefundMethod('Cash');
    setRefundRestock(true);
    setRefundReason('');
    setRefundNote('');
  };

  const refundPreview = useMemo(() => {
    if (!refundSale) return null;
    const selections = Object.entries(refundQty)
      .filter(([, quantity]) => quantity > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (selections.length === 0) return null;
    try {
      return computeRefundAllocation(
        refundSale.items
          .filter((item): item is typeof item & { id: string } => Boolean(item.id))
          .map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unitPriceCents: Math.round(item.unitPrice * 100),
            refundedQuantity: item.refundedQuantity ?? 0,
          })),
        Math.round(refundSale.totalAmount * 100),
        selections,
      );
    } catch {
      return null;
    }
  }, [refundSale, refundQty]);

  const submitRefund = async () => {
    if (!refundSale) return;
    const items = Object.entries(refundQty)
      .filter(([, quantity]) => quantity > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (items.length === 0) {
      showToast('Choose at least one item to refund.', 'error');
      return;
    }
    if (refundReason.trim().length < 3) {
      showToast('Enter a reason for the refund.', 'error');
      return;
    }
    setRefunding(true);
    try {
      const result = await api<{ refund: RefundRecord; sale: SaleTransaction }>(
        `/api/sales/${refundSale.id}/refunds`,
        {
          method: 'POST',
          body: {
            items,
            method: refundMethod,
            reason: refundReason.trim(),
            note: refundNote.trim() || undefined,
            restock: refundRestock,
          },
        },
      );
      setRefundSale(null);
      setRefundReceipt(result);
      await onRefresh();
      showToast(`Refund ${result.refund.refundNo} recorded.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not record the refund.', 'error');
    } finally {
      setRefunding(false);
    }
  };

  const openRefundReceipt = async (refund: RefundRecord) => {
    try {
      const result = await api<{ sale: SaleTransaction }>(`/api/sales/${refund.saleId}`);
      setRefundReceipt({ sale: result.sale, refund });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load the original sale.', 'error');
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Receipts & refunds"
        description="Search sales, reprint receipts and process returns."
        action={
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-zinc-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setTab('sales')}
              className={cn(
                'px-3 py-2 text-xs font-medium cursor-pointer',
                tab === 'sales' ? 'bg-rose-900 text-white' : 'text-stone-600 dark:text-zinc-300',
              )}
            >
              Sales
            </button>
            <button
              type="button"
              onClick={() => setTab('refunds')}
              className={cn(
                'px-3 py-2 text-xs font-medium cursor-pointer',
                tab === 'refunds' ? 'bg-rose-900 text-white' : 'text-stone-600 dark:text-zinc-300',
              )}
            >
              Refunds
            </button>
          </div>
        }
      />

      <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="p-3 border-b border-stone-100 dark:border-zinc-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'sales' ? 'Search receipt, cashier, M-Pesa code…' : 'Search refund or receipt…'}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </div>
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-zinc-700 overflow-hidden">
            {(
              [
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7 days' },
                { id: '30d', label: '30 days' },
                { id: 'all', label: 'All' },
              ] as Array<{ id: RangeKey; label: string }>
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setRange(option.id)}
                className={cn(
                  'px-2.5 py-2 text-xs font-medium cursor-pointer',
                  range === option.id
                    ? 'bg-rose-900 text-white'
                    : 'text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {tab === 'sales' && (
            <>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as PaymentMode | 'all')}
                className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none"
              >
                <option value="all">All payments</option>
                <option value="Cash">Cash</option>
                <option value="Mpesa">M-Pesa</option>
                <option value="Credit">Credit</option>
              </select>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as SaleStatus | 'all')}
                className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="Completed">Completed</option>
                <option value="Partially Refunded">Partially refunded</option>
                <option value="Refunded">Refunded</option>
              </select>
            </>
          )}
        </div>

        {loadError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Retry
            </Button>
          </div>
        ) : loading ? (
          <Spinner label="Loading receipts…" className="py-16" />
        ) : tab === 'sales' ? (
          sales.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="w-5 h-5" />}
              title="No receipts in this range"
              description="Sales recorded at the register will appear here."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 dark:text-zinc-400 border-b border-stone-100 dark:border-zinc-800">
                      <th className="px-3 py-2 font-semibold">Receipt</th>
                      <th className="px-3 py-2 font-semibold hidden sm:table-cell">When</th>
                      <th className="px-3 py-2 font-semibold hidden md:table-cell">Cashier</th>
                      <th className="px-3 py-2 font-semibold">Payment</th>
                      <th className="px-3 py-2 font-semibold text-right hidden sm:table-cell">Items</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                    {sales.map((sale) => {
                      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                      return (
                        <tr key={sale.id} className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/40">
                          <td className="px-3 py-2.5">
                            <p className="font-mono text-xs font-semibold">{sale.receiptNo}</p>
                            <p className="text-[10px] text-stone-400 sm:hidden">{timeOnly(sale.createdAt)}</p>
                          </td>
                          <td className="px-3 py-2.5 hidden sm:table-cell">
                            <p className="text-xs">{dateOnly(sale.businessDate)}</p>
                            <p className="text-[10px] text-stone-400">{timeOnly(sale.createdAt)}</p>
                          </td>
                          <td className="px-3 py-2.5 hidden md:table-cell text-xs text-stone-600 dark:text-zinc-300">
                            {sale.cashier}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs">{sale.paymentMode}</span>
                              {sale.mpesaDetails?.transactionCode && (
                                <span className="font-mono text-[10px] text-stone-400">
                                  {sale.mpesaDetails.transactionCode}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs hidden sm:table-cell">{itemCount}</td>
                          <td className="px-3 py-2.5 text-right">
                            <p className="font-mono text-xs font-semibold">{money(sale.totalAmount, currency)}</p>
                            {sale.discountAmount > 0 && (
                              <p className="text-[10px] text-stone-400">-{money(sale.discountAmount, currency)}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={STATUS_TONES[sale.status]}>{sale.status}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setViewSale(sale)}
                                className="p-1.5 rounded-md text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
                                title="View receipt"
                                aria-label={`View ${sale.receiptNo}`}
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openRefund(sale)}
                                disabled={sale.status === 'Refunded'}
                                className="p-1.5 rounded-md text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 disabled:opacity-30 cursor-pointer"
                                title="Refund"
                                aria-label={`Refund ${sale.receiptNo}`}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2.5 border-t border-stone-100 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs">
                <span className="text-stone-500 dark:text-zinc-400">
                  {total} receipt(s) · page {page} of {pages}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Newer
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Older <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )
        ) : visibleRefunds.length === 0 ? (
          <EmptyState
            icon={<RotateCcw className="w-5 h-5" />}
            title="No refunds in this range"
            description="Refunds processed against sales appear here with their original receipt."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 dark:text-zinc-400 border-b border-stone-100 dark:border-zinc-800">
                  <th className="px-3 py-2 font-semibold">Refund</th>
                  <th className="px-3 py-2 font-semibold">Original sale</th>
                  <th className="px-3 py-2 font-semibold hidden md:table-cell">When</th>
                  <th className="px-3 py-2 font-semibold">Method</th>
                  <th className="px-3 py-2 font-semibold hidden sm:table-cell">Restocked</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                {visibleRefunds.map((refund) => (
                  <tr key={refund.id} className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/40">
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-xs font-semibold">{refund.refundNo}</p>
                      <p className="text-[10px] text-stone-500 dark:text-zinc-400 max-w-[220px] truncate">
                        {refund.reason}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{refund.saleReceiptNo}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell text-xs">{dateTime(refund.createdAt)}</td>
                    <td className="px-3 py-2.5 text-xs">{refund.method}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <Badge tone={refund.restocked ? 'green' : 'neutral'}>
                        {refund.restocked ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold">
                      {money(refund.totalAmount, currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void openRefundReceipt(refund)}
                        className="p-1.5 rounded-md text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
                        aria-label={`View refund ${refund.refundNo}`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewSale && (
        <ReceiptModal
          open
          onClose={() => setViewSale(null)}
          sale={viewSale}
          settings={settings}
          credit={creditFor(viewSale)}
        />
      )}

      {refundReceipt && (
        <ReceiptModal
          open
          onClose={() => setRefundReceipt(null)}
          sale={refundReceipt.sale}
          settings={settings}
          credit={creditFor(refundReceipt.sale)}
          refund={refundReceipt.refund}
        />
      )}

      <Modal
        open={refundSale !== null}
        onClose={() => setRefundSale(null)}
        title="Process refund"
        subtitle={refundSale ? `${refundSale.receiptNo} · ${money(refundSale.totalAmount, currency)}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundSale(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void submitRefund()}
              loading={refunding}
              disabled={!refundPreview || refundReason.trim().length < 3}
            >
              <RotateCcw className="w-4 h-4" /> Refund {refundPreview ? moneyExact(refundPreview.totalCents / 100, currency) : ''}
            </Button>
          </>
        }
      >
        {refundSale && (
          <div className="space-y-4">
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 divide-y divide-stone-100 dark:divide-zinc-800">
              {refundSale.items.map((item) => {
                const itemId = item.id;
                const remaining = item.quantity - (item.refundedQuantity ?? 0);
                const selected = itemId ? refundQty[itemId] ?? 0 : 0;
                const allocated = refundPreview?.lines.find((line) => line.saleItemId === itemId);
                return (
                  <div key={itemId ?? item.productId} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                        {item.quantity} sold · {item.refundedQuantity ?? 0} already refunded ·{' '}
                        {moneyExact(item.unitPrice, currency)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center rounded-md border border-stone-200 dark:border-zinc-700">
                        <button
                          type="button"
                          onClick={() =>
                            itemId &&
                            setRefundQty((current) => ({
                              ...current,
                              [itemId]: Math.max(0, (current[itemId] ?? 0) - 1),
                            }))
                          }
                          disabled={remaining === 0}
                          className="px-2 py-1 text-sm hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30 cursor-pointer"
                          aria-label="Less"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm font-mono">{selected}</span>
                        <button
                          type="button"
                          onClick={() =>
                            itemId &&
                            setRefundQty((current) => ({
                              ...current,
                              [itemId]: Math.min(remaining, (current[itemId] ?? 0) + 1),
                            }))
                          }
                          disabled={remaining === 0 || selected >= remaining}
                          className="px-2 py-1 text-sm hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-30 cursor-pointer"
                          aria-label="More"
                        >
                          +
                        </button>
                      </div>
                      {allocated && (
                        <span className="font-mono text-xs w-20 text-right">
                          {moneyExact(allocated.amountCents / 100, currency)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          itemId &&
                          setRefundQty((current) => ({ ...current, [itemId]: remaining }))
                        }
                        disabled={remaining === 0}
                        className="text-[10px] font-medium text-rose-900 dark:text-rose-400 underline underline-offset-2 disabled:opacity-30 cursor-pointer"
                      >
                        All
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-xs font-medium">
                Refund method
                <select
                  value={refundMethod}
                  onChange={(event) => setRefundMethod(event.target.value as 'Cash' | 'Mpesa')}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none"
                >
                  <option value="Cash">Cash payout</option>
                  <option value="Mpesa">M-Pesa payout</option>
                </select>
              </label>
              <label className="flex items-start gap-2 text-xs font-medium mt-5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={refundRestock}
                  onChange={(event) => setRefundRestock(event.target.checked)}
                  className="accent-rose-900 mt-0.5"
                />
                <span>
                  Return items to stock
                  <span className="block text-[11px] font-normal text-stone-500 dark:text-zinc-400">
                    Uncheck for damaged or used products.
                  </span>
                </span>
              </label>
              <label className="block text-xs font-medium sm:col-span-2">
                Reason *
                <input
                  type="text"
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  placeholder="e.g. Wrong shade, customer changed mind"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </label>
              <label className="block text-xs font-medium sm:col-span-2">
                Note
                <input
                  type="text"
                  value={refundNote}
                  onChange={(event) => setRefundNote(event.target.value)}
                  placeholder="Optional internal note"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </label>
            </div>

            <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-medium">Refund total</span>
              <span className="font-mono text-lg font-semibold">
                {refundPreview ? moneyExact(refundPreview.totalCents / 100, currency) : moneyExact(0, currency)}
              </span>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              Discounts are prorated across the returned items. If the original sale was on credit, the customer’s
              balance is reduced automatically.
            </p>
            {refundSale.paymentMode === 'Mpesa' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                M-Pesa refunds are recorded for reconciliation; send the payout from the till or M-Pesa app.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
