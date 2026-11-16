import React, { useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  Receipt,
  ScanBarcode,
  Search,
  Send,
  ShoppingBag,
  Smartphone,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  MpesaDetails,
  PaymentMode,
  PRODUCT_CATEGORIES,
  Product,
  ProductCategory,
  SaleItem,
  SaleTransaction,
  StoreSettings,
} from '../types';
import { ProductThumbnail } from './ProductThumbnail';
import { MpesaMessagePanel } from './MpesaMessagePanel';
import { generateSimulatedMpesaSms, parseMpesaMessage } from '../lib/mpesaParser';

interface PosViewProps {
  products: Product[];
  transactions: SaleTransaction[];
  settings: StoreSettings;
  onOpenScanner: (onDetected: (barcode: string) => void) => void;
  onCompleteSale: (payload: {
    items: SaleItem[];
    totalAmount: number;
    paymentMode: PaymentMode;
    mpesaDetails?: MpesaDetails;
    creditorName?: string;
    creditorPhone?: string;
    pendingDate?: string;
    dueDate?: string;
    creditNotes?: string;
    initialDeposit?: number;
  }) => Promise<SaleTransaction | null>;
}

export const PosView: React.FC<PosViewProps> = ({
  products,
  transactions,
  settings,
  onOpenScanner,
  onCompleteSale,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'All'>('All');
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');

  // M-Pesa mode: 'prompt' (STK Push to customer phone) or 'sms' (Access / paste M-Pesa SMS)
  const [mpesaFlow, setMpesaFlow] = useState<'prompt' | 'sms'>('prompt');
  const [customerMpesaPhone, setCustomerMpesaPhone] = useState('');
  const [customerMpesaName, setCustomerMpesaName] = useState('');
  const [stkState, setStkState] = useState<'idle' | 'sent' | 'confirmed'>('idle');
  const [mpesaRawMsg, setMpesaRawMsg] = useState('');
  const [mpesaParsed, setMpesaParsed] = useState<MpesaDetails | undefined>(undefined);
  const [mpesaValid, setMpesaValid] = useState(false);

  // Credit / Pending checkout fields
  const [creditorName, setCreditorName] = useState('');
  const [creditorPhone, setCreditorPhone] = useState('');
  const [pendingDate, setPendingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [initialDeposit, setInitialDeposit] = useState('');
  const [creditNotes, setCreditNotes] = useState('');

  // Payment Prompt Modal state
  const [payPromptOpen, setPayPromptOpen] = useState(false);
  const [cashTendered, setCashTendered] = useState('');

  const [scanNotice, setScanNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<SaleTransaction | null>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const catMatch = selectedCategory === 'All' || p.category === selectedCategory;
      const searchMatch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q) ||
        p.brand.toLowerCase().includes(q);
      return catMatch && searchMatch;
    });
  }, [products, search, selectedCategory]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      setScanNotice(`${product.name} is out of stock.`);
      return;
    }
    setScanNotice('');
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map((c) =>
          c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.product.id !== productId) return c;
          const nextQty = Math.min(c.product.stock, c.quantity + delta);
          return { ...c, quantity: nextQty };
        })
        .filter((c) => c.quantity > 0),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.product.id !== productId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.product.currentPrice * item.quantity, 0);

  const handleBarcodeScanned = (code: string) => {
    const match = products.find(
      (p) =>
        p.barcode.toLowerCase() === code.trim().toLowerCase() ||
        p.sku.toLowerCase() === code.trim().toLowerCase(),
    );
    if (match) {
      addToCart(match);
      setScanNotice(`Scanned: ${match.name}`);
    } else {
      setScanNotice(`No product found matching barcode "${code}".`);
    }
  };

  const handleSendStkPrompt = () => {
    const phone = customerMpesaPhone.trim();
    if (!/^(?:\+?254|0)[17]\d{8}$/.test(phone.replace(/\s+/g, ''))) {
      setScanNotice('Enter a valid Kenyan M-Pesa phone number (e.g. 0712345678).');
      return;
    }
    setScanNotice('');
    setStkState('sent');
  };

  const handleConfirmStkPrompt = () => {
    const phone = customerMpesaPhone.trim() || '0712345678';
    const sender = (customerMpesaName.trim() || 'M-PESA CUSTOMER').toUpperCase();
    const sms = generateSimulatedMpesaSms(cartTotal, settings.mpesaTillNumber, sender, phone);
    const parsed = parseMpesaMessage(sms, cartTotal);
    setMpesaRawMsg(sms);
    setMpesaParsed(parsed.details);
    setMpesaValid(parsed.valid);
    setStkState('confirmed');
  };

  const openPaymentPrompt = () => {
    if (cart.length === 0) return;
    if (paymentMode === 'Credit' && !creditorName.trim()) {
      setScanNotice('Please enter the creditor name before proceeding.');
      return;
    }
    setScanNotice('');
    setCashTendered(String(cartTotal));
    setPayPromptOpen(true);
  };

  const handleConfirmSale = async () => {
    if (cart.length === 0 || submitting) return;
    if (paymentMode === 'Mpesa' && !mpesaRawMsg.trim()) {
      setScanNotice('Send & confirm the M-Pesa prompt or attach an M-Pesa SMS first.');
      return;
    }
    if (paymentMode === 'Credit' && !creditorName.trim()) {
      setScanNotice('Please enter the creditor name for Credit / Pending checkout.');
      return;
    }

    setSubmitting(true);
    setScanNotice('');
    try {
      const items: SaleItem[] = cart.map((c) => ({
        productId: c.product.id,
        productName: c.product.name,
        category: c.product.category,
        quantity: c.quantity,
        unitPrice: c.product.currentPrice,
        costPrice: c.product.costPrice,
      }));

      const tx = await onCompleteSale({
        items,
        totalAmount: cartTotal,
        paymentMode,
        mpesaDetails: paymentMode === 'Mpesa' ? mpesaParsed : undefined,
        creditorName: paymentMode === 'Credit' ? creditorName : undefined,
        creditorPhone: paymentMode === 'Credit' ? creditorPhone : undefined,
        pendingDate: paymentMode === 'Credit' ? pendingDate : undefined,
        dueDate: paymentMode === 'Credit' ? dueDate : undefined,
        creditNotes: paymentMode === 'Credit' ? creditNotes : undefined,
        initialDeposit: paymentMode === 'Credit' ? Number(initialDeposit || 0) : undefined,
      });

      if (tx) {
        setLastReceipt(tx);
        setPayPromptOpen(false);
        setCart([]);
        setMpesaRawMsg('');
        setMpesaParsed(undefined);
        setMpesaValid(false);
        setStkState('idle');
        setCustomerMpesaPhone('');
        setCustomerMpesaName('');
        setCreditorName('');
        setCreditorPhone('');
        setInitialDeposit('');
        setCreditNotes('');
        setCashTendered('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const tenderedNum = Number(cashTendered || 0);
  const changeDue = Math.max(0, tenderedNum - cartTotal);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Catalog & Barcode Search */}
      <div className="lg:col-span-7 space-y-4 no-print">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim()) {
                  const exactBarcode = products.find((p) => p.barcode === search.trim());
                  if (exactBarcode) {
                    addToCart(exactBarcode);
                    setSearch('');
                  }
                }
              }}
              placeholder="Search product name or scan barcode..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </div>
          <button
            type="button"
            onClick={() => onOpenScanner(handleBarcodeScanned)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-stone-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ScanBarcode className="w-4 h-4" />
            <span>Scan Barcode</span>
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedCategory('All')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              selectedCategory === 'All'
                ? 'bg-rose-900 text-white dark:bg-rose-700'
                : 'bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
            }`}
          >
            All Items
          </button>
          {PRODUCT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                selectedCategory === cat
                  ? 'bg-rose-900 text-white dark:bg-rose-700'
                  : 'bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {scanNotice && (
          <div className="px-3.5 py-2 rounded-lg bg-stone-100 dark:bg-zinc-800/80 border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-200">
            {scanNotice}
          </div>
        )}

        {/* Product Selection Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredProducts.map((p) => {
            const outOfStock = p.stock <= 0;
            return (
              <button
                key={p.id}
                type="button"
                disabled={outOfStock}
                onClick={() => addToCart(p)}
                className={`text-left p-3.5 rounded-xl border transition-all flex items-center gap-3.5 ${
                  outOfStock
                    ? 'border-stone-200 dark:border-zinc-800 bg-stone-100/60 dark:bg-zinc-900/40 opacity-60 cursor-not-allowed'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-rose-300 dark:hover:border-rose-700 cursor-pointer active:scale-[0.99]'
                }`}
              >
                <ProductThumbnail
                  imageUrl={p.imageUrl}
                  name={p.name}
                  category={p.category}
                  className="w-14 h-14 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                    {p.name}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">
                    {p.category} · {p.stock} left
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-semibold font-mono-num text-rose-900 dark:text-rose-400">
                      {settings.currency} {p.currentPrice.toLocaleString()}
                    </span>
                    {p.currentPrice !== p.basePrice && (
                      <span className="text-xs font-mono-num line-through text-stone-400">
                        {p.basePrice.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Recent Today's Transactions */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-3 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-stone-500" />
            <span>Recent Register Receipts</span>
          </h3>
          <div className="divide-y divide-stone-100 dark:divide-zinc-800">
            {transactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900 dark:text-zinc-100">
                    <span className="font-mono-num">{tx.receiptNo}</span> · {tx.paymentMode}
                    {tx.mpesaDetails?.transactionCode ? ` (${tx.mpesaDetails.transactionCode})` : ''}
                  </p>
                  <p className="text-stone-500 dark:text-zinc-400 truncate">
                    {tx.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                  </p>
                </div>
                <span className="font-semibold font-mono-num text-stone-900 dark:text-zinc-100 shrink-0">
                  {settings.currency} {tx.totalAmount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Active Checkout Basket & Payment Mode */}
      <div className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5 lg:sticky lg:top-6">
        <div className="flex items-center justify-between no-print">
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-rose-900 dark:text-rose-400" />
            <span>Current Sale</span>
          </h2>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
              className="text-xs text-stone-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 cursor-pointer"
            >
              Clear Basket
            </button>
          )}
        </div>

        {/* Completed Receipt Card */}
        {lastReceipt && cart.length === 0 && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1 flex-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                  Sale Completed · Receipt {lastReceipt.receiptNo}
                </p>
                <p className="text-emerald-800 dark:text-emerald-300 font-mono-num">
                  Total: {settings.currency} {lastReceipt.totalAmount.toLocaleString()} via{' '}
                  {lastReceipt.paymentMode}
                  {lastReceipt.mpesaDetails?.transactionCode
                    ? ` (${lastReceipt.mpesaDetails.transactionCode})`
                    : ''}
                </p>
                <p className="text-emerald-700/90 dark:text-emerald-300/80">
                  {lastReceipt.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-zinc-900 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setLastReceipt(null)}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {cart.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-stone-200 dark:border-zinc-800 rounded-xl no-print">
            <p className="text-sm font-medium text-stone-600 dark:text-zinc-300">Basket is empty</p>
            <p className="text-xs text-stone-400 dark:text-zinc-500 mt-1">
              Click any product or scan a barcode to start checkout.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-zinc-800 max-h-60 overflow-y-auto pr-1 no-print">
            {cart.map(({ product, quantity }) => (
              <div key={product.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                    {product.name}
                  </p>
                  <p className="text-xs font-mono-num text-stone-500 dark:text-zinc-400">
                    {settings.currency} {product.currentPrice.toLocaleString()} each
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateQty(product.id, -1)}
                    className="w-7 h-7 rounded-md border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-7 text-center text-xs font-mono-num font-semibold text-stone-900 dark:text-zinc-100">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQty(product.id, 1)}
                    className="w-7 h-7 rounded-md border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromCart(product.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-stone-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                    aria-label="Remove item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total Summary */}
        <div className="pt-4 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-between no-print">
          <span className="text-sm font-medium text-stone-600 dark:text-zinc-400">Amount Due</span>
          <span className="text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {cartTotal.toLocaleString()}
          </span>
        </div>

        {/* Payment Mode Selector */}
        <div className="space-y-2 no-print">
          <p className="text-xs font-medium text-stone-600 dark:text-zinc-400">Mode of Payment</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { mode: 'Cash', icon: Banknote, label: 'Cash' },
                { mode: 'Mpesa', icon: Smartphone, label: 'M-Pesa' },
                { mode: 'Credit', icon: UserCheck, label: 'Credit' },
              ] as const
            ).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaymentMode(mode)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  paymentMode === mode
                    ? 'border-rose-900 bg-rose-900 text-white dark:border-rose-600 dark:bg-rose-700'
                    : 'border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* M-Pesa Payment Options: STK Phone Prompt OR Confirmation SMS */}
        {paymentMode === 'Mpesa' && (
          <div className="space-y-3 no-print">
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-stone-100 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setMpesaFlow('prompt')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  mpesaFlow === 'prompt'
                    ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                    : 'text-stone-600 dark:text-zinc-400'
                }`}
              >
                Send Phone Prompt
              </button>
              <button
                type="button"
                onClick={() => setMpesaFlow('sms')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  mpesaFlow === 'sms'
                    ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-sm'
                    : 'text-stone-600 dark:text-zinc-400'
                }`}
              >
                Access M-Pesa SMS
              </button>
            </div>

            {mpesaFlow === 'prompt' ? (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    M-Pesa STK Prompt (Till {settings.mpesaTillNumber})
                  </span>
                  {stkState === 'confirmed' && mpesaParsed && (
                    <span className="text-[11px] font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">
                      Verified · {mpesaParsed.transactionCode}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="tel"
                    value={customerMpesaPhone}
                    onChange={(e) => {
                      setCustomerMpesaPhone(e.target.value);
                      if (stkState !== 'idle') setStkState('idle');
                    }}
                    placeholder="Customer M-Pesa phone (07...)"
                    className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                  <input
                    type="text"
                    value={customerMpesaName}
                    onChange={(e) => setCustomerMpesaName(e.target.value)}
                    placeholder="Customer name (optional)"
                    className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                  />
                </div>

                {stkState === 'idle' && (
                  <button
                    type="button"
                    disabled={cartTotal <= 0}
                    onClick={handleSendStkPrompt}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      Send Prompt to Phone ({settings.currency} {cartTotal.toLocaleString()})
                    </span>
                  </button>
                )}

                {stkState === 'sent' && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2.5">
                    <p className="text-xs text-amber-900 dark:text-amber-200">
                      STK Prompt sent to <span className="font-mono-num font-semibold">{customerMpesaPhone}</span> for{' '}
                      <span className="font-mono-num font-semibold">
                        {settings.currency} {cartTotal.toLocaleString()}
                      </span>
                      . Ask customer to enter M-Pesa PIN.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleConfirmStkPrompt}
                        className="flex-1 py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                      >
                        Customer Entered PIN · Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setStkState('idle')}
                        className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs text-stone-600 dark:text-zinc-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {stkState === 'confirmed' && mpesaParsed && (
                  <div className="rounded-lg bg-emerald-100/80 dark:bg-emerald-950/60 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200 space-y-0.5">
                    <p className="font-semibold">
                      M-Pesa Prompt Confirmed · Code {mpesaParsed.transactionCode}
                    </p>
                    <p className="text-[11px] opacity-90">{mpesaParsed.rawMessage}</p>
                  </div>
                )}
              </div>
            ) : (
              <MpesaMessagePanel
                expectedAmount={cartTotal}
                tillNumber={settings.mpesaTillNumber}
                value={mpesaRawMsg}
                onChange={(raw, parsed, valid) => {
                  setMpesaRawMsg(raw);
                  setMpesaParsed(parsed);
                  setMpesaValid(valid);
                }}
              />
            )}
          </div>
        )}

        {/* Credit / Pending Details */}
        {paymentMode === 'Credit' && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 no-print">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Credit &amp; Pending Ledger Entry
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={creditorName}
                onChange={(e) => setCreditorName(e.target.value)}
                placeholder="Creditor full name *"
                className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
              />
              <input
                type="tel"
                value={creditorPhone}
                onChange={(e) => setCreditorPhone(e.target.value)}
                placeholder="Phone (e.g. 0712...)"
                className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
              />
              <div>
                <label className="block text-[11px] text-stone-500 dark:text-zinc-400 mb-1">
                  Pending Day Date
                </label>
                <input
                  type="date"
                  value={pendingDate}
                  onChange={(e) => setPendingDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 dark:text-zinc-400 mb-1">
                  Expected Payment Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="number"
                min={0}
                max={cartTotal}
                value={initialDeposit}
                onChange={(e) => setInitialDeposit(e.target.value)}
                placeholder="Deposit paid now (optional)"
                className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
              />
              <input
                type="text"
                value={creditNotes}
                onChange={(e) => setCreditNotes(e.target.value)}
                placeholder="Notes (salon, agreement...)"
                className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={cart.length === 0 || submitting}
          onClick={openPaymentPrompt}
          className="w-full py-3 px-4 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer no-print"
        >
          Proceed to Pay ({settings.currency} {cartTotal.toLocaleString()})
        </button>
      </div>

      {/* Payment Confirmation Prompt Modal */}
      {payPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Payment Confirmation Prompt
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  {cart.reduce((s, i) => s + i.quantity, 0)} items · {paymentMode} Checkout
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayPromptOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 p-4 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                Total Amount Due
              </span>
              <span className="text-xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
                {settings.currency} {cartTotal.toLocaleString()}
              </span>
            </div>

            {paymentMode === 'Cash' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                    Cash Tendered ({settings.currency})
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-base font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[cartTotal, 500, 1000, 2000, 5000].map((amt, idx) => (
                    <button
                      key={`${amt}-${idx}`}
                      type="button"
                      onClick={() => setCashTendered(String(amt))}
                      className="px-2.5 py-1 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-mono-num text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      {idx === 0 ? 'Exact' : amt.toLocaleString()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-stone-100 dark:border-zinc-800 text-sm">
                  <span className="text-stone-600 dark:text-zinc-400">Change Due</span>
                  <span className="font-semibold font-mono-num text-emerald-700 dark:text-emerald-400">
                    {settings.currency} {changeDue.toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {paymentMode === 'Mpesa' && (
              <div className="space-y-3">
                {mpesaRawMsg.trim() ? (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 text-xs space-y-1">
                    <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                      {mpesaValid ? 'M-Pesa Payment Verified' : 'M-Pesa Confirmation Attached'}
                      {mpesaParsed?.transactionCode ? ` · ${mpesaParsed.transactionCode}` : ''}
                    </p>
                    <p className="text-emerald-800 dark:text-emerald-300">{mpesaRawMsg}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 p-3.5 space-y-2.5">
                    <p className="text-xs text-amber-900 dark:text-amber-200">
                      No M-Pesa confirmation attached yet. Send an instant STK prompt to the customer&apos;s phone:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={customerMpesaPhone}
                        onChange={(e) => setCustomerMpesaPhone(e.target.value)}
                        placeholder="Customer phone (07...)"
                        className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmStkPrompt}
                        className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        Prompt &amp; Verify
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {paymentMode === 'Credit' && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 text-xs space-y-1.5">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Creditor: {creditorName}
                </p>
                <p className="text-stone-600 dark:text-zinc-400 font-mono-num">
                  Pending Day: {pendingDate} · Due: {dueDate}
                </p>
                <p className="text-stone-700 dark:text-zinc-300 font-mono-num">
                  Deposit: {settings.currency} {Number(initialDeposit || 0).toLocaleString()} · Balance:{' '}
                  {settings.currency}{' '}
                  {Math.max(0, cartTotal - Number(initialDeposit || 0)).toLocaleString()}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPayPromptOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
              >
                Back to Basket
              </button>
              <button
                type="button"
                disabled={
                  submitting ||
                  (paymentMode === 'Cash' && tenderedNum < cartTotal) ||
                  (paymentMode === 'Mpesa' && !mpesaRawMsg.trim())
                }
                onClick={() => void handleConfirmSale()}
                className="px-5 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
              >
                {submitting ? 'Completing...' : 'Confirm & Complete Sale'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
