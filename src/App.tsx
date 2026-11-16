import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Package,
  PlusCircle,
  Settings,
  ShoppingCart,
  Sun,
  UserCheck,
  X,
} from 'lucide-react';
import {
  AppDatabase,
  CreditRecord,
  MpesaDetails,
  PaymentMode,
  Product,
  SaleItem,
  SaleTransaction,
  StoreSettings,
} from './types';
import { PinLockScreen } from './components/PinLockScreen';
import { OverviewView } from './components/OverviewView';
import { PosView } from './components/PosView';
import { InventoryView } from './components/InventoryView';
import { ProductFormView } from './components/ProductFormView';
import { CreditPendingView } from './components/CreditPendingView';
import { MonthlyReportsView } from './components/MonthlyReportsView';
import { SettingsView } from './components/SettingsView';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';

type NavTab =
  | 'overview'
  | 'pos'
  | 'inventory'
  | 'add-product'
  | 'credits'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'pos', label: 'Point of Sale', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'add-product', label: 'Add Product', icon: PlusCircle },
  { id: 'credits', label: 'Credit & Pending', icon: UserCheck },
  { id: 'reports', label: 'Monthly Reports', icon: BarChart3 },
  { id: 'settings', label: 'Store Settings', icon: Settings },
];

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'Whispers Cosmetics',
  logoUrl: '',
  pin: '1234',
  currency: 'Ksh',
  mpesaTillNumber: '5482910',
  autoDynamicEnabled: false,
  theme: 'light',
};

export default function App() {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<string>('');

  // Shared Barcode Scanner modal state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerCallback, setScannerCallback] = useState<(code: string) => void>(() => () => {});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const data = (await res.json()) as AppDatabase;
        setDb(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Apply Light/Dark mode class on <html>
  const currentTheme = db?.settings.theme ?? DEFAULT_SETTINGS.theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', currentTheme === 'dark');
  }, [currentTheme]);

  const openScanner = useCallback((onDetected: (barcode: string) => void) => {
    setScannerCallback(() => onDetected);
    setScannerOpen(true);
  }, []);

  const handleSaveSettings = async (partial: Partial<StoreSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    if (res.ok) {
      const updated = (await res.json()) as StoreSettings;
      setDb((prev) => (prev ? { ...prev, settings: updated } : prev));
    }
  };

  const handleToggleTheme = () => {
    const next = currentTheme === 'dark' ? 'light' : 'dark';
    void handleSaveSettings({ theme: next });
  };

  const handleCreateProduct = async (
    payload: Omit<Product, 'id' | 'updatedAt'>,
    options?: { addAnother?: boolean },
  ) => {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created = (await res.json()) as Product;
      setDb((prev) => (prev ? { ...prev, products: [created, ...prev.products] } : prev));
      showToast(`Added "${created.name}" to inventory.`);
      if (!options?.addAnother) {
        setActiveTab('inventory');
      }
    }
  };

  const handleUpdateProduct = async (id: string, data: Partial<Product>) => {
    const res = await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = (await res.json()) as Product;
      setDb((prev) =>
        prev
          ? { ...prev, products: prev.products.map((p) => (p.id === id ? updated : p)) }
          : prev,
      );
      showToast(`Updated ${updated.name}.`);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDb((prev) =>
        prev ? { ...prev, products: prev.products.filter((p) => p.id !== id) } : prev,
      );
      showToast('Product removed from catalog.');
    }
  };

  const handleCompleteSale = async (payload: {
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
  }): Promise<SaleTransaction | null> => {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      transaction: SaleTransaction;
      creditRecord?: CreditRecord;
      products: Product[];
    };
    setDb((prev) =>
      prev
        ? {
            ...prev,
            products: data.products,
            transactions: [data.transaction, ...prev.transactions],
            credits: data.creditRecord ? [data.creditRecord, ...prev.credits] : prev.credits,
          }
        : prev,
    );
    showToast(`Recorded receipt ${data.transaction.receiptNo}.`);
    return data.transaction;
  };

  const handleCreateCredit = async (payload: {
    creditorName: string;
    creditorPhone: string;
    pendingDate: string;
    dueDate: string;
    totalAmount: number;
    amountPaid: number;
    notes: string;
    items: CreditRecord['items'];
  }) => {
    const res = await fetch('/api/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created = (await res.json()) as CreditRecord;
      setDb((prev) => (prev ? { ...prev, credits: [created, ...prev.credits] } : prev));
      showToast(`Created credit entry for ${created.creditorName}.`);
    }
  };

  const handleUpdateCredit = async (
    id: string,
    payload: {
      creditorName: string;
      creditorPhone: string;
      pendingDate: string;
      dueDate: string;
      notes: string;
    },
  ) => {
    const res = await fetch(`/api/credits/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = (await res.json()) as CreditRecord;
      setDb((prev) =>
        prev
          ? { ...prev, credits: prev.credits.map((c) => (c.id === id ? updated : c)) }
          : prev,
      );
      showToast(`Updated creditor details for ${updated.creditorName}.`);
    }
  };

  const handleRecordCreditPayment = async (
    id: string,
    payload: {
      amount: number;
      method: 'Cash' | 'Mpesa';
      mpesaDetails?: MpesaDetails;
      note?: string;
    },
  ) => {
    const res = await fetch(`/api/credits/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = (await res.json()) as CreditRecord;
      setDb((prev) =>
        prev
          ? { ...prev, credits: prev.credits.map((c) => (c.id === id ? updated : c)) }
          : prev,
      );
      showToast(`Payment recorded for ${updated.creditorName}.`);
    }
  };

  if (loading || !db) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-rose-900/15 dark:bg-rose-800/30 mx-auto animate-pulse" />
          <p className="text-sm text-stone-500 dark:text-zinc-400">
            Loading Whispers Cosmetics...
          </p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <PinLockScreen
        settings={db.settings}
        onUnlock={() => setUnlocked(true)}
        onToggleTheme={handleToggleTheme}
      />
    );
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <div className="min-h-screen flex bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 transition-colors duration-200">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0 no-print">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-stone-200 dark:border-zinc-800">
          {db.settings.logoUrl ? (
            <img
              src={db.settings.logoUrl}
              alt={`${db.settings.storeName} Logo`}
              className="w-9 h-9 rounded-lg object-cover border border-stone-200 dark:border-zinc-700 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-rose-900 dark:bg-rose-800 text-white flex items-center justify-center shrink-0">
              <span className="font-display text-base font-semibold">WC</span>
            </div>
          )}
          <span className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-zinc-50 truncate">
            {db.settings.storeName}
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-rose-900 text-white dark:bg-rose-700'
                    : 'text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 hover:text-stone-900 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-stone-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setUnlocked(false)}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>Lock Register (PIN)</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-zinc-900 border-r border-stone-200 dark:border-zinc-800 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-stone-200 dark:border-zinc-800">
              <span className="font-display text-xl font-semibold text-stone-900 dark:text-zinc-50 truncate">
                {db.settings.storeName}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-stone-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveTab(id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === id
                      ? 'bg-rose-900 text-white dark:bg-rose-700'
                      : 'text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 px-4 sm:px-8 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-stone-400 dark:text-zinc-500 hidden sm:inline">
                {db.settings.storeName}
              </span>
              <span className="text-stone-300 dark:text-zinc-700 hidden sm:inline">/</span>
              <h1 className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                {activeNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 transition-colors cursor-pointer whitespace-nowrap"
              aria-label="Toggle Light or Dark Mode"
            >
              {currentTheme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {currentTheme === 'dark' ? 'Light' : 'Dark'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'pos' ? 'add-product' : 'pos')}
              className="px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              {activeTab === 'pos' ? '+ Add Product' : 'Open POS'}
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
          {toast && (
            <div className="mb-5 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs font-medium text-emerald-900 dark:text-emerald-200 flex items-center gap-2 no-print">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{toast}</span>
            </div>
          )}

          {activeTab === 'overview' && (
            <OverviewView
              products={db.products}
              transactions={db.transactions}
              credits={db.credits}
              settings={db.settings}
              onNavigate={(tab) => setActiveTab(tab)}
              onApplyDynamicPrice={async (id, price) => {
                await handleUpdateProduct(id, { currentPrice: price });
              }}
              onQuickRestock={async (id, addQty) => {
                const target = db.products.find((p) => p.id === id);
                if (target) {
                  await handleUpdateProduct(id, { stock: target.stock + addQty });
                }
              }}
            />
          )}

          {activeTab === 'pos' && (
            <PosView
              products={db.products}
              transactions={db.transactions}
              settings={db.settings}
              onOpenScanner={openScanner}
              onCompleteSale={handleCompleteSale}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              products={db.products}
              transactions={db.transactions}
              settings={db.settings}
              onUpdateProduct={handleUpdateProduct}
              onDeleteProduct={handleDeleteProduct}
              onGoToAddProduct={() => setActiveTab('add-product')}
            />
          )}

          {activeTab === 'add-product' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">
                  Add New Cosmetic Product or Listing
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                  Follow the 4 steps below to upload product photography, assign category, set stock &amp; pricing, and track expiration dates.
                </p>
              </div>
              <ProductFormView
                settings={db.settings}
                submitLabel="Save & View Inventory"
                onSubmit={handleCreateProduct}
              />
            </div>
          )}

          {activeTab === 'credits' && (
            <CreditPendingView
              credits={db.credits}
              products={db.products}
              settings={db.settings}
              onCreateCredit={handleCreateCredit}
              onUpdateCredit={handleUpdateCredit}
              onRecordPayment={handleRecordCreditPayment}
            />
          )}

          {activeTab === 'reports' && (
            <MonthlyReportsView
              transactions={db.transactions}
              products={db.products}
              settings={db.settings}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView settings={db.settings} onSaveSettings={handleSaveSettings} />
          )}
        </main>
      </div>

      {/* Global Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={scannerOpen}
        products={db.products}
        onClose={() => setScannerOpen(false)}
        onDetected={scannerCallback}
      />
    </div>
  );
}
