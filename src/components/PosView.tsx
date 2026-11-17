import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  ShoppingBag,
  Smartphone,
  Trash2,
  Wallet,
} from 'lucide-react';
import type {
  AppMeta,
  CreditPayment,
  CreditRecord,
  MpesaDetails,
  MpesaInfo,
  MpesaIntentStatus,
  PaymentMode,
  Product,
  SaleTransaction,
  StoreSettings,
} from '../types';
import { api } from '../lib/api';
import { addDays, cn, dateOnly, money, moneyExact } from '../lib/format';
import { printReceipt } from '../lib/print';
import { Badge, Button, EmptyState, SectionHeading } from './ui';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { MpesaMessagePanel } from './MpesaMessagePanel';
import { ProductThumbnail } from './ProductThumbnail';
import { ReceiptModal, ReceiptPaper } from './Receipt';

interface PosViewProps {
  products: Product[];
  settings: StoreSettings;
  mpesa: MpesaInfo;
  meta: AppMeta;
  credits: CreditRecord[];
  onRefresh: () => Promise<void>;
  onNavigate: (route: string) => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface SaleResponse {
  sale: SaleTransaction;
  credit?: CreditRecord;
  deposit?: CreditPayment;
}

interface IntentState {
  id: string;
  status: string;
  message: string;
  receipt?: string;
}

const PAYMENT_MODES: Array<{ id: PaymentMode; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'Cash', label: 'Cash', icon: Banknote },
  { id: 'Mpesa', label: 'M-Pesa', icon: Smartphone },
  { id: 'Credit', label: 'Credit', icon: CreditCard },
];

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export const PosView: React.FC<PosViewProps> = ({
  products,
  settings,
  mpesa,
  meta,
  onRefresh,
  onNavigate,
  showToast,
}) => {
  const currency = settings.currency;
  const activeProducts = useMemo(() => products.filter((product) => !product.archived), [products]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [discount, setDiscount] = useState('');
  const [cashTendered, setCashTendered] = useState('');
  const [note, setNote] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<SaleResponse | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const [mpesaMethod, setMpesaMethod] = useState<'stk' | 'manual'>(
    mpesa.configured ? 'stk' : 'manual',
  );
  const [stkPhone, setStkPhone] = useState('');
  const [intent, setIntent] = useState<IntentState | null>(null);
  const [stkBusy, setStkBusy] = useState(false);
  const [manual, setManual] = useState<{ raw: string; details: MpesaDetails; valid: boolean } | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState(() => addDays(meta.today, 14));
  const [creditNotes, setCreditNotes] = useState('');
  const [deposit, setDeposit] = useState('');
  const [depositMethod, setDepositMethod] = useState<'Cash' | 'Mpesa'>('Cash');
  const [depositMpesa, setDepositMpesa] = useState<{ raw: string; details: MpesaDetails; valid: boolean } | null>(null);
  const pollRef = useRef<number | null>(null);

  const byId = useMemo(() => new Map(activeProducts.map((product) => [product.id, product])), [activeProducts]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = byId.get(productId);
          return product && quantity > 0 ? { product, quantity } : null;
        })
        .filter((line): line is { product: Product; quantity: number } => line !== null),
    [cart, byId],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.product.currentPrice * line.quantity, 0),
    [lines],
  );
  const discountValue = Math.min(Math.max(toNumber(discount), 0), subtotal);
  const total = Math.max(0, Math.round((subtotal - discountValue) * 100) / 100);
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);

  const cashGiven = cashTendered.trim() ? toNumber(cashTendered) : total;
  const change = Math.max(0, Math.round((cashGiven - total) * 100) / 100);

  const mpesaLocked = intent !== null;
  const stkPending = intent?.status === 'pending';
  const stkSuccess = intent?.status === 'success';
  const wholeShilling = Number.isInteger(total);
  const canUseManual = mpesa.manualEnabled;
  const manualDetails = manual?.valid ? manual.details : null;
  const depositValue = Math.min(Math.max(toNumber(deposit), 0), total);
  const depositMpesaDetails = depositMpesa?.valid ? depositMpesa.details : null;

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(activeProducts.map((product) => product.category)))],
    [activeProducts],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return activeProducts.filter((product) => {
      if (category !== 'All' && product.category !== category) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.brand.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.barcode.toLowerCase().includes(term)
      );
    });
  }, [activeProducts, category, search]);

  useEffect(() => {
    if (!intent || intent.status !== 'pending') return;
    let cancelled = false;

    const schedule = (delay: number) => {
      pollRef.current = window.setTimeout(() => void poll(), delay);
    };

    let attempts = 0;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api<{ intent: MpesaIntentStatus }>(`/api/mpesa/status/${intent.id}`);
        if (cancelled) return;
        const status = result.intent;
        if (status.status !== 'pending') {
          setIntent({
            id: status.id,
            status: status.status,
            message: status.resultDesc ?? '',
            receipt: status.mpesaReceipt ?? undefined,
          });
          if (status.status === 'success') {
            showToast(
              `M-Pesa confirmed${status.mpesaReceipt ? ` · ${status.mpesaReceipt}` : ''}. Complete the sale.`,
            );
          } else {
            showToast(
              status.resultDesc || `M-Pesa request ${status.status}. Ask the customer to try again.`,
              'error',
            );
          }
          return;
        }
        attempts += 1;
        if (attempts >= 60) {
          setIntent((current) =>
            current
              ? {
                  ...current,
                  message:
                    'Still waiting for Safaricom confirmation. Check the customer’s phone, then retry or confirm manually.',
                }
              : current,
          );
          return;
        }
        schedule(3000);
      } catch {
        if (!cancelled) schedule(4000);
      }
    };

    schedule(2200);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [intent?.id, intent?.status, showToast]);

  const addToCart = (product: Product, quantity = 1) => {
    if (mpesaLocked) {
      showToast('Finish or reset the M-Pesa request before changing the cart.', 'info');
      return;
    }
    if (product.stock <= 0) {
      showToast(`${product.name} is out of stock.`, 'error');
      return;
    }
    setCart((current) => {
      const next = Math.min(product.stock, (current[product.id] ?? 0) + quantity);
      return { ...current, [product.id]: next };
    });
  };

  const changeQuantity = (product: Product, delta: number) => {
    if (mpesaLocked) return;
    setCart((current) => {
      const next = Math.max(0, Math.min(product.stock, (current[product.id] ?? 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[product.id];
      else copy[product.id] = next;
      return copy;
    });
  };

  const removeLine = (productId: string) => {
    if (mpesaLocked) return;
    setCart((current) => {
      const copy = { ...current };
      delete copy[productId];
      return copy;
    });
  };

  const resetSale = () => {
    setCart({});
    setDiscount('');
    setCashTendered('');
    setNote('');
    setManual(null);
    setIntent(null);
    setCustomerName('');
    setCustomerPhone('');
    setCreditNotes('');
    setDeposit('');
    setDepositMethod('Cash');
    setDepositMpesa(null);
    setDueDate(addDays(meta.today, 14));
  };

  const handleScan = (barcode: string) => {
    const match = activeProducts.find((product) => product.barcode === barcode.trim());
    if (match) {
      addToCart(match);
      showToast(`${match.name} added to the sale.`);
    } else {
      setSearch(barcode.trim());
      showToast(`No product matches barcode ${barcode}.`, 'error');
    }
  };

  const startStk = async () => {
    if (total <= 0) {
      showToast('Add products before requesting M-Pesa.', 'error');
      return;
    }
    if (!wholeShilling) {
      showToast('STK Push needs a whole-shilling total. Adjust the discount.', 'error');
      return;
    }
    if (!stkPhone.trim()) {
      showToast('Enter the customer’s M-Pesa phone number.', 'error');
      return;
    }
    setStkBusy(true);
    try {
      const result = await api<{ intentId: string; status: string; message: string }>(
        '/api/mpesa/stkpush',
        {
          method: 'POST',
          body: {
            phone: stkPhone.trim(),
            amount: total,
            purpose: 'sale',
            accountReference: settings.storeName,
          },
        },
      );
      setIntent({ id: result.intentId, status: result.status, message: result.message });
      showToast('STK Push sent. Ask the customer to enter their M-Pesa PIN.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send the STK Push.', 'error');
    } finally {
      setStkBusy(false);
    }
  };

  const checkIntent = async () => {
    if (!intent) return;
    try {
      const result = await api<{ intent: MpesaIntentStatus }>(`/api/mpesa/status/${intent.id}`);
      setIntent({
        id: result.intent.id,
        status: result.intent.status,
        message: result.intent.resultDesc ?? '',
        receipt: result.intent.mpesaReceipt ?? undefined,
      });
      if (result.intent.status === 'success') {
        showToast('M-Pesa payment confirmed.');
      } else if (result.intent.status !== 'pending') {
        showToast(result.intent.resultDesc || 'The customer did not complete the payment.', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check the payment.', 'error');
    }
  };

  const completeSale = async () => {
    if (lines.length === 0) {
      showToast('Add at least one product to the sale.', 'error');
      return;
    }
    if (discount.trim() && toNumber(discount) > subtotal) {
      showToast('The discount cannot be more than the subtotal.', 'error');
      return;
    }
    if (paymentMode === 'Cash' && cashTendered.trim() && toNumber(cashTendered) < total) {
      showToast('Cash tendered is less than the total.', 'error');
      return;
    }
    if (paymentMode === 'Mpesa') {
      if (mpesaMethod === 'stk' && !stkSuccess) {
        showToast('Wait for the M-Pesa payment to be confirmed first.', 'error');
        return;
      }
      if (mpesaMethod === 'manual' && !manualDetails) {
        showToast('Attach a valid M-Pesa confirmation message first.', 'error');
        return;
      }
    }
    if (paymentMode === 'Credit') {
      if (customerName.trim().length < 2) {
        showToast('Enter the customer’s name for the credit account.', 'error');
        return;
      }
      if (!dueDate || dueDate < meta.today) {
        showToast('Choose a due date on or after today.', 'error');
        return;
      }
      if (depositValue > 0 && depositMethod === 'Mpesa' && !depositMpesaDetails) {
        showToast('Confirm the M-Pesa deposit details first.', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        paymentMode,
        note: note.trim() || undefined,
      };
      if (discount.trim() && discountValue > 0) payload.discountAmount = discountValue;

      if (paymentMode === 'Cash') {
        payload.cashTendered = cashGiven;
      } else if (paymentMode === 'Mpesa') {
        payload.mpesa =
          mpesaMethod === 'stk'
            ? { intentId: intent?.id }
            : {
                transactionCode: manualDetails?.transactionCode,
                amountReceived: manualDetails?.amountReceived,
                senderName: manualDetails?.senderName,
                senderPhone: manualDetails?.senderPhone,
                rawMessage: manualDetails?.rawMessage,
              };
      } else {
        payload.credit = {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          dueDate,
          notes: creditNotes.trim() || undefined,
          amountPaid: depositValue > 0 ? depositValue : undefined,
          paymentMethod: depositValue > 0 ? depositMethod : undefined,
          mpesa:
            depositValue > 0 && depositMethod === 'Mpesa'
              ? {
                  transactionCode: depositMpesaDetails?.transactionCode,
                  amountReceived: depositMpesaDetails?.amountReceived,
                  senderName: depositMpesaDetails?.senderName,
                  senderPhone: depositMpesaDetails?.senderPhone,
                  rawMessage: depositMpesaDetails?.rawMessage,
                }
              : undefined,
        };
      }

      const result = await api<SaleResponse>('/api/sales', { method: 'POST', body: payload });
      setCompleted(result);
      setReceiptOpen(true);
      resetSale();
      await onRefresh();
      showToast(`Sale ${result.sale.receiptNo} completed.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The sale could not be saved.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cashSuggestions = useMemo(() => {
    const rounded = (step: number) => Math.ceil(total / step) * step;
    return Array.from(new Set([total, rounded(50), rounded(100), rounded(500), rounded(1000)])).filter(
      (value) => value >= total && value <= 100_000,
    );
  }, [total]);

  const completionReason = (() => {
    if (lines.length === 0) return 'Add products to start a sale.';
    if (paymentMode === 'Mpesa' && mpesaMethod === 'stk' && !stkSuccess) {
      return 'Request payment and wait for Safaricom confirmation.';
    }
    if (paymentMode === 'Mpesa' && mpesaMethod === 'manual' && !manualDetails) {
      return 'Attach a valid M-Pesa confirmation message.';
    }
    if (paymentMode === 'Credit' && customerName.trim().length < 2) {
      return 'Enter the customer name to open a credit account.';
    }
    return '';
  })();

  if (completed) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-9 h-9 text-emerald-700 dark:text-emerald-400" />
            <div>
              <h2 className="font-display text-2xl font-semibold">Sale recorded</h2>
              <p className="text-sm text-stone-600 dark:text-zinc-300 mt-0.5">
                {completed.sale.receiptNo} · {money(completed.sale.totalAmount, currency)} ·{' '}
                {completed.sale.paymentMode}
                {completed.sale.paymentMode === 'Cash' && completed.sale.changeGiven
                  ? ` · Change ${money(completed.sale.changeGiven, currency)}`
                  : ''}
              </p>
              {completed.credit && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Credit balance{' '}
                  {money(completed.credit.totalAmount - completed.credit.amountPaid, currency)} due{' '}
                  {dateOnly(completed.credit.dueDate)}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setReceiptOpen(true)}>
              View receipt
            </Button>
            <Button variant="secondary" onClick={printReceipt}>
              <Printer className="w-4 h-4" /> Print
            </Button>
            <Button
              onClick={() => {
                setCompleted(null);
                setReceiptOpen(false);
              }}
            >
              New sale
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <SectionHeading title="What's next?" description="Keep the queue moving." />
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setCompleted(null);
                  setReceiptOpen(false);
                }}
                className="text-left rounded-lg border border-stone-200 dark:border-zinc-800 p-4 hover:border-rose-300 dark:hover:border-rose-800 cursor-pointer"
              >
                <ShoppingBag className="w-5 h-5 text-rose-900 dark:text-rose-400 mb-2" />
                <p className="text-sm font-semibold">Start another sale</p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                  Cart and payment fields are already cleared.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompleted(null);
                  setReceiptOpen(false);
                  onNavigate('receipts');
                }}
                className="text-left rounded-lg border border-stone-200 dark:border-zinc-800 p-4 hover:border-rose-300 dark:hover:border-rose-800 cursor-pointer"
              >
                <BadgeCheck className="w-5 h-5 text-emerald-700 dark:text-emerald-400 mb-2" />
                <p className="text-sm font-semibold">Open receipts</p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                  Reprint, search or refund this sale.
                </p>
              </button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <ReceiptPaper sale={completed.sale} settings={settings} credit={completed.credit} />
          </div>
        </div>

        <ReceiptModal
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          sale={completed.sale}
          settings={settings}
          credit={completed.credit}
        />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
      <div className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, brand, SKU or barcode…"
              className="w-full pl-3.5 pr-10 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-stone-500 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
              aria-label="Scan barcode"
            >
              <ScanBarcode className="w-4 h-4" />
            </button>
          </div>
          <Badge tone="neutral" className="px-2.5 py-1.5">
            {activeProducts.length} product(s)
          </Badge>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setCategory(entry)}
              className={cn(
                'px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                category === entry
                  ? 'bg-rose-900 border-rose-900 text-white'
                  : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800',
              )}
            >
              {entry}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <EmptyState
              icon={<ShoppingBag className="w-5 h-5" />}
              title="No products found"
              description="Try another search term or add products in Inventory."
              action={
                <Button variant="secondary" onClick={() => onNavigate('inventory')}>
                  Open inventory
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((product) => {
              const inCart = cart[product.id] ?? 0;
              const out = product.stock <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addToCart(product)}
                  disabled={out || mpesaLocked}
                  className={cn(
                    'relative text-left rounded-xl border bg-white dark:bg-zinc-900 p-3 transition-all cursor-pointer group disabled:opacity-60 disabled:cursor-not-allowed',
                    inCart > 0
                      ? 'border-rose-800 dark:border-rose-600 ring-1 ring-rose-800/20'
                      : 'border-stone-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-800',
                  )}
                >
                  {inCart > 0 && (
                    <span className="absolute top-2 right-2 z-10 min-w-5 h-5 px-1 rounded-full bg-rose-900 text-white text-[10px] font-semibold flex items-center justify-center">
                      {inCart}
                    </span>
                  )}
                  <ProductThumbnail
                    imageUrl={product.imageUrl}
                    name={product.name}
                    category={product.category}
                    className="w-full h-24 rounded-lg mb-2"
                  />
                  <p className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.4em]">{product.name}</p>
                  <p className="text-[10px] text-stone-400 dark:text-zinc-500 truncate">{product.brand || product.category}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="font-mono text-sm font-semibold">{money(product.currentPrice, currency)}</span>
                    <Badge tone={out ? 'red' : product.stock <= product.reorderLevel ? 'amber' : 'neutral'}>
                      {out ? 'Out' : `${product.stock}`}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart */}
      <aside className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col lg:sticky lg:top-4 max-h-[calc(100vh-2rem)]">
        <div className="px-4 py-3 border-b border-stone-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">Current sale</h2>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              {totalQty} item(s) · {lines.length} line(s)
            </p>
          </div>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={resetSale}
              disabled={mpesaLocked}
              className="text-xs font-medium text-stone-500 hover:text-red-600 dark:text-zinc-400 disabled:opacity-40 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[80px]">
          {lines.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="w-5 h-5" />}
              title="Cart is empty"
              description="Tap a product or scan a barcode to begin."
            />
          ) : (
            lines.map(({ product, quantity }) => (
              <div key={product.id} className="rounded-lg border border-stone-100 dark:border-zinc-800 p-2">
                <div className="flex items-start gap-2">
                  <ProductThumbnail
                    imageUrl={product.imageUrl}
                    name={product.name}
                    category={product.category}
                    className="w-9 h-9 rounded-md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{product.name}</p>
                    <p className="text-[10px] text-stone-500 dark:text-zinc-400 font-mono">
                      {money(product.currentPrice, currency)} each
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(product.id)}
                    disabled={mpesaLocked}
                    className="p-1 text-stone-400 hover:text-red-600 disabled:opacity-40 cursor-pointer"
                    aria-label={`Remove ${product.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="inline-flex items-center rounded-md border border-stone-200 dark:border-zinc-700">
                    <button
                      type="button"
                      onClick={() => changeQuantity(product, -1)}
                      disabled={mpesaLocked}
                      className="p-1.5 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center text-xs font-mono">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(product, 1)}
                      disabled={mpesaLocked || quantity >= product.stock}
                      className="p-1.5 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-mono text-xs font-semibold">
                    {money(product.currentPrice * quantity, currency)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-stone-100 dark:border-zinc-800 px-4 py-3 space-y-3">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-stone-600 dark:text-zinc-300">
              <span>Subtotal</span>
              <span className="font-mono">{money(subtotal, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="pos-discount" className="text-stone-600 dark:text-zinc-300">
                Discount
              </label>
              <input
                id="pos-discount"
                type="number"
                min={0}
                max={subtotal}
                step="0.01"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                disabled={mpesaLocked}
                placeholder="0"
                className="w-28 px-2 py-1 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30 disabled:opacity-60"
              />
            </div>
            <div className="flex justify-between items-baseline pt-1.5 border-t border-dashed border-stone-200 dark:border-zinc-700">
              <span className="text-sm font-semibold">Total</span>
              <span className="font-mono text-lg font-semibold">{money(total, currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    if (mpesaLocked && mode.id !== 'Mpesa') {
                      showToast('Finish or reset the M-Pesa request first.', 'info');
                      return;
                    }
                    setPaymentMode(mode.id);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer',
                    paymentMode === mode.id
                      ? 'border-rose-800 bg-rose-50 text-rose-900 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-200'
                      : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {mode.label}
                </button>
              );
            })}
          </div>

          {paymentMode === 'Cash' && (
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="pos-cash" className="text-xs font-medium">
                  Cash received
                </label>
                <input
                  id="pos-cash"
                  type="number"
                  min={0}
                  step="0.01"
                  value={cashTendered}
                  onChange={(event) => setCashTendered(event.target.value)}
                  placeholder={String(total)}
                  className="w-28 px-2 py-1 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cashSuggestions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCashTendered(String(value))}
                    className="px-2 py-1 rounded-md bg-stone-100 dark:bg-zinc-800 text-[10px] font-mono hover:bg-stone-200 dark:hover:bg-zinc-700 cursor-pointer"
                  >
                    {value.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-stone-500 dark:text-zinc-400">Change</span>
                <span className="font-mono font-semibold">{money(change, currency)}</span>
              </div>
            </div>
          )}

          {paymentMode === 'Mpesa' && (
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium inline-flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  {mpesa.configured ? 'Safaricom Daraja' : 'Manual confirmation'}
                </span>
                {canUseManual && mpesa.configured && (
                  <div className="inline-flex rounded-md border border-stone-200 dark:border-zinc-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMpesaMethod('stk')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium cursor-pointer',
                        mpesaMethod === 'stk'
                          ? 'bg-rose-900 text-white'
                          : 'text-stone-600 dark:text-zinc-300',
                      )}
                    >
                      STK Push
                    </button>
                    <button
                      type="button"
                      onClick={() => setMpesaMethod('manual')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium cursor-pointer',
                        mpesaMethod === 'manual'
                          ? 'bg-rose-900 text-white'
                          : 'text-stone-600 dark:text-zinc-300',
                      )}
                    >
                      SMS code
                    </button>
                  </div>
                )}
              </div>

              {mpesaMethod === 'stk' && mpesa.configured ? (
                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    <input
                      type="tel"
                      value={stkPhone}
                      onChange={(event) => setStkPhone(event.target.value)}
                      placeholder="07XX XXX XXX"
                      disabled={mpesaLocked}
                      className="flex-1 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60"
                    />
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => void startStk()}
                      loading={stkBusy}
                      disabled={mpesaLocked || total <= 0 || !wholeShilling}
                    >
                      Send
                    </Button>
                  </div>
                  {!wholeShilling && total > 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      STK Push requires a whole-shilling total. Adjust the discount.
                    </p>
                  )}
                  {intent && (
                    <div
                      className={cn(
                        'rounded-md px-2.5 py-2 text-[11px] space-y-1',
                        stkSuccess
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                          : intent.status === 'pending'
                            ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {stkSuccess
                            ? `Confirmed${intent.receipt ? ` · ${intent.receipt}` : ''}`
                            : intent.status === 'pending'
                              ? 'Waiting for customer…'
                              : `Payment ${intent.status}`}
                        </span>
                        {intent.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => void checkIntent()}
                            className="underline underline-offset-2 cursor-pointer"
                          >
                            Check
                          </button>
                        )}
                      </div>
                      {intent.message && <p className="opacity-80">{intent.message}</p>}
                      {intent.status !== 'success' && (
                        <button
                          type="button"
                          onClick={() => setIntent(null)}
                          className="underline underline-offset-2 cursor-pointer"
                        >
                          {intent.status === 'pending' ? 'Cancel request' : 'Reset payment'}
                        </button>
                      )}
                    </div>
                  )}
                  {!intent && (
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                      A prompt will be sent to the customer’s phone to enter their M-Pesa PIN.
                    </p>
                  )}
                </div>
              ) : canUseManual ? (
                <MpesaMessagePanel
                  expectedAmount={total}
                  tillNumber={settings.mpesaTillNumber || '—'}
                  value={manual?.raw ?? ''}
                  onChange={(raw, details, valid) => setManual({ raw, details, valid })}
                />
              ) : (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {mpesa.reason ?? 'M-Pesa is not configured. Set Daraja credentials to accept M-Pesa.'}
                </p>
              )}
            </div>
          )}

          {paymentMode === 'Credit' && (
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Customer name *"
                  className="col-span-2 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Phone (optional)"
                  className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
                <input
                  type="date"
                  value={dueDate}
                  min={meta.today}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
                <input
                  type="number"
                  min={0}
                  max={total}
                  step="0.01"
                  value={deposit}
                  onChange={(event) => setDeposit(event.target.value)}
                  placeholder="Deposit paid now"
                  className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
                <select
                  value={depositMethod}
                  onChange={(event) => setDepositMethod(event.target.value as 'Cash' | 'Mpesa')}
                  className="px-2 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none"
                >
                  <option value="Cash">Deposit by cash</option>
                  <option value="Mpesa" disabled={!mpesa.manualEnabled && !mpesa.configured}>
                    Deposit by M-Pesa
                  </option>
                </select>
                <input
                  type="text"
                  value={creditNotes}
                  onChange={(event) => setCreditNotes(event.target.value)}
                  placeholder="Credit notes"
                  className="col-span-2 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </div>
              {depositValue > 0 && depositMethod === 'Mpesa' && canUseManual && (
                <MpesaMessagePanel
                  expectedAmount={depositValue}
                  tillNumber={settings.mpesaTillNumber || '—'}
                  value={depositMpesa?.raw ?? ''}
                  onChange={(raw, details, valid) => setDepositMpesa({ raw, details, valid })}
                />
              )}
              <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                Balance on credit:{' '}
                <span className="font-mono font-semibold">{money(Math.max(0, total - depositValue), currency)}</span>
                {' '}· due {dueDate ? dateOnly(dueDate) : '—'}
              </p>
            </div>
          )}

          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Sale note (optional)"
            className="w-full px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-rose-800/30"
          />

          {completionReason && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">{completionReason}</p>
          )}

          <Button
            className="w-full py-3"
            onClick={() => void completeSale()}
            loading={submitting}
            disabled={lines.length === 0}
          >
            {submitting ? 'Recording sale…' : `Complete sale · ${moneyExact(total, currency)}`}
          </Button>
          {settings.receiptFooter && (
            <p className="text-[10px] text-center text-stone-400 dark:text-zinc-500">{meta.timezone}</p>
          )}
        </div>
      </aside>

      <BarcodeScannerModal
        isOpen={scannerOpen}
        products={activeProducts}
        title="Scan to add to sale"
        onClose={() => setScannerOpen(false)}
        onDetected={handleScan}
      />
    </div>
  );
};
