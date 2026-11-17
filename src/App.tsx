import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Package,
  ReceiptText,
  ScrollText,
  Settings as SettingsIcon,
  ShoppingCart,
  Sun,
  UserCheck,
  WifiOff,
  X,
} from 'lucide-react';
import type { BootstrapData, Product, SessionInfo, StoreSettings } from './types';
import { api, ApiError } from './lib/api';
import { cn, dateOnly, initials } from './lib/format';
import { PinLockScreen } from './components/PinLockScreen';
import { OverviewView } from './components/OverviewView';
import { PosView } from './components/PosView';
import { InventoryView } from './components/InventoryView';
import { ProductFormView } from './components/ProductFormView';
import { CreditPendingView } from './components/CreditPendingView';
import { ReceiptsView } from './components/ReceiptsView';
import { MonthlyReportsView } from './components/MonthlyReportsView';
import { AuditLogView } from './components/AuditLogView';
import { SettingsView } from './components/SettingsView';
import { Spinner } from './components/ui';

type Route =
  | 'overview'
  | 'pos'
  | 'inventory'
  | 'new-product'
  | 'credits'
  | 'receipts'
  | 'reports'
  | 'audit'
  | 'settings';

const ROUTES: Route[] = [
  'overview',
  'pos',
  'inventory',
  'new-product',
  'credits',
  'receipts',
  'reports',
  'audit',
  'settings',
];

const NAV: Array<{ id: Route; label: string; icon: React.FC<{ className?: string }>; mobile?: boolean }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, mobile: true },
  { id: 'pos', label: 'Point of Sale', icon: ShoppingCart, mobile: true },
  { id: 'inventory', label: 'Inventory', icon: Package, mobile: true },
  { id: 'credits', label: 'Credits & Pending', icon: UserCheck, mobile: true },
  { id: 'receipts', label: 'Receipts & Refunds', icon: ReceiptText },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
  { id: 'settings', label: 'Store Settings', icon: SettingsIcon },
];

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'overview';
}

type ToastKind = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  kind: ToastKind;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingBoot, setLoadingBoot] = useState(false);
  const [bootError, setBootError] = useState('');
  const [route, setRoute] = useState<Route>(readRoute);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = window.localStorage.getItem('wc-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [online, setOnline] = useState(() => navigator.onLine);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string, kind: ToastKind = 'success') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem('wc-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoadingBoot(true);
    setBootError('');
    try {
      const data = await api<BootstrapData>('/api/bootstrap');
      setBoot(data);
      setSession((current) =>
        current ? { ...current, pinIsDefault: data.settings.pinIsDefault } : current,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setBoot(null);
      } else {
        setBootError(error instanceof Error ? error.message : 'Could not load store data.');
      }
    } finally {
      setLoadingBoot(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await api<SessionInfo>('/api/session', { silent401: true });
        if (cancelled) return;
        setSession(info);
        if (info.authenticated) {
          if (info.store.theme) setTheme(info.store.theme);
          await loadBootstrap();
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : 'Could not reach the server.', 'error');
        }
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBootstrap, showToast]);

  useEffect(() => {
    const onUnauthorized = () => {
      setSession((current) => (current ? { ...current, authenticated: false } : current));
      setBoot(null);
      showToast('Your register session expired. Enter the PIN again.', 'info');
    };
    window.addEventListener('wc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wc:unauthorized', onUnauthorized);
  }, [showToast]);

  const refresh = useCallback(async () => {
    await loadBootstrap();
  }, [loadBootstrap]);

  const navigate = useCallback((next: string) => {
    const target: Route = (ROUTES as string[]).includes(next) ? (next as Route) : 'overview';
    window.location.hash = `#/${target}`;
    setRoute(target);
    setMenuOpen(false);
  }, []);

  const handleUnlocked = useCallback(
    async (nextSession: SessionInfo) => {
      setSession(nextSession);
      if (nextSession.store.theme) setTheme(nextSession.store.theme);
      await loadBootstrap();
      showToast('Register unlocked.');
    },
    [loadBootstrap, showToast],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {}, silent401: true });
    } catch {
      // session is cleared locally regardless
    }
    setBoot(null);
    setSession((current) => (current ? { ...current, authenticated: false } : current));
    showToast('Register locked.', 'info');
  }, [showToast]);

  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (session?.authenticated) {
      try {
        const result = await api<{ settings: StoreSettings }>('/api/settings', {
          method: 'PATCH',
          body: { theme: next },
        });
        setBoot((current) => (current ? { ...current, settings: result.settings } : current));
      } catch {
        // keep local preference even if saving fails
      }
    }
  }, [session?.authenticated, theme]);

  const store = session?.store;
  const storeName = boot?.settings.storeName ?? store?.storeName ?? 'Whispers Cosmetics';
  const logoUrl = boot?.settings.logoUrl ?? store?.logoUrl ?? '';
  const currency = boot?.settings.currency ?? store?.currency ?? 'Ksh';

  const activeTitle = useMemo(() => {
    if (route === 'new-product') return editingProduct ? 'Edit product' : 'Add product';
    return NAV.find((item) => item.id === route)?.label ?? 'Overview';
  }, [route, editingProduct]);

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-zinc-950">
        <Spinner label="Opening register…" />
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <PinLockScreen
        storeName={storeName}
        logoUrl={logoUrl}
        theme={theme}
        onUnlocked={(next) => void handleUnlocked(next)}
        onToggleTheme={() => void toggleTheme()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="no-print hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="h-16 flex items-center gap-3 px-5 border-b border-stone-100 dark:border-zinc-800">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-9 h-9 rounded-lg object-cover border border-stone-200 dark:border-zinc-700" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-rose-900 text-white flex items-center justify-center font-display text-sm font-semibold">
              {initials(storeName) || 'WC'}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display text-base font-semibold truncate leading-tight">{storeName}</p>
            <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-zinc-500">
              Whispers POS
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === route || (item.id === 'inventory' && route === 'new-product');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'inventory') {
                    setEditingProduct(null);
                  }
                  navigate(item.id);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                  active
                    ? 'bg-rose-900 text-white shadow-sm'
                    : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 hover:text-stone-900 dark:hover:text-zinc-100',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-stone-100 dark:border-zinc-800 space-y-3">
          <div className="text-[11px] text-stone-500 dark:text-zinc-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>Business date</span>
              <span className="font-mono">{boot?.meta.today ? dateOnly(boot.meta.today) : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>M-Pesa</span>
              <span className={boot?.mpesa.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {boot?.mpesa.configured ? 'STK live' : 'Manual'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void toggleTheme()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" /> Lock
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="no-print lg:hidden sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-stone-200 dark:border-zinc-800">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="p-2 -ml-2 rounded-lg text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-md bg-rose-900 text-white flex items-center justify-center text-[10px] font-semibold">
                {initials(storeName)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">{storeName}</p>
              <p className="text-[10px] text-stone-400 dark:text-zinc-500 truncate">{activeTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleTheme()}
            className="p-2 rounded-lg text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-stone-950/50"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-zinc-900 shadow-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-900 text-white flex items-center justify-center font-display text-xs font-semibold">
                  {initials(storeName)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{storeName}</p>
                  <p className="text-[10px] text-stone-400">Business date {boot?.meta.today}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = item.id === route || (item.id === 'inventory' && route === 'new-product');
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'inventory') setEditingProduct(null);
                      navigate(item.id);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                      active
                        ? 'bg-rose-900 text-white'
                        : 'text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800',
                    )}
                  >
                    <Icon className="w-4 h-4" /> {item.label}
                  </button>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-sm text-stone-600 dark:text-zinc-300"
            >
              <Lock className="w-4 h-4" /> Lock register
            </button>
          </div>
        </div>
      )}

      <main className="lg:pl-64 pb-20 lg:pb-0">
        <div className="no-print hidden lg:flex h-16 items-center justify-between px-8 border-b border-stone-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur">
          <div>
            <h1 className="font-display text-xl font-semibold leading-tight">{activeTitle}</h1>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              {boot?.meta.today ? dateOnly(boot.meta.today) : ''} · {boot?.meta.timezone}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', boot?.mpesa.configured ? 'bg-emerald-500' : 'bg-amber-500')} />
              {boot?.mpesa.configured ? `M-Pesa ${boot.mpesa.environment}` : 'Manual M-Pesa'}
            </span>
            <span className="text-stone-300 dark:text-zinc-700">|</span>
            <span className="font-mono">{currency}</span>
          </div>
        </div>

        {!online && (
          <div className="mx-4 lg:mx-8 mt-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-300 flex items-center gap-2">
            <WifiOff className="w-4 h-4" /> You are offline. Sales cannot be saved until the connection returns.
          </div>
        )}

        {boot?.settings.pinIsDefault && (
          <div className="no-print mx-4 lg:mx-8 mt-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Security:</strong> the register is still using the default PIN. Change it before handing the till to staff.
            </span>
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="font-semibold underline underline-offset-2 cursor-pointer"
            >
              Change PIN
            </button>
          </div>
        )}

        <div className="px-4 lg:px-8 py-5 lg:py-7">
          {loadingBoot && !boot ? (
            <div className="py-24">
              <Spinner label="Loading store data…" />
            </div>
          ) : bootError && !boot ? (
            <div className="max-w-md mx-auto text-center py-20">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{bootError}</p>
              <button
                type="button"
                onClick={() => void loadBootstrap()}
                className="mt-3 px-4 py-2 rounded-lg bg-rose-900 text-white text-sm font-medium"
              >
                Retry
              </button>
            </div>
          ) : boot ? (
            <>
              {route === 'overview' && (
                <OverviewView data={boot} onNavigate={navigate} onRefresh={refresh} showToast={showToast} />
              )}
              {route === 'pos' && (
                <PosView
                  products={boot.products}
                  settings={boot.settings}
                  mpesa={boot.mpesa}
                  meta={boot.meta}
                  credits={boot.credits}
                  onRefresh={refresh}
                  onNavigate={navigate}
                  showToast={showToast}
                />
              )}
              {route === 'inventory' && (
                <InventoryView
                  products={boot.products}
                  settings={boot.settings}
                  onRefresh={refresh}
                  onAdd={() => {
                    setEditingProduct(null);
                    navigate('new-product');
                  }}
                  onEdit={(product) => {
                    setEditingProduct(product);
                    navigate('new-product');
                  }}
                  showToast={showToast}
                />
              )}
              {route === 'new-product' && (
                <ProductFormView
                  key={editingProduct?.id ?? 'new'}
                  product={editingProduct}
                  settings={boot.settings}
                  onSaved={async (another) => {
                    await refresh();
                    if (!another) {
                      setEditingProduct(null);
                      navigate('inventory');
                    }
                  }}
                  onCancel={() => {
                    setEditingProduct(null);
                    navigate('inventory');
                  }}
                  showToast={showToast}
                />
              )}
              {route === 'credits' && (
                <CreditPendingView
                  credits={boot.credits}
                  settings={boot.settings}
                  mpesa={boot.mpesa}
                  onRefresh={refresh}
                  showToast={showToast}
                />
              )}
              {route === 'receipts' && (
                <ReceiptsView
                  settings={boot.settings}
                  credits={boot.credits}
                  onRefresh={refresh}
                  showToast={showToast}
                />
              )}
              {route === 'reports' && (
                <MonthlyReportsView settings={boot.settings} meta={boot.meta} showToast={showToast} />
              )}
              {route === 'audit' && <AuditLogView showToast={showToast} />}
              {route === 'settings' && (
                <SettingsView
                  settings={boot.settings}
                  meta={boot.meta}
                  mpesa={boot.mpesa}
                  onSettingsChange={(settings) => {
                    setBoot((current) => (current ? { ...current, settings } : current));
                    setTheme(settings.theme);
                  }}
                  onLogout={logout}
                  showToast={showToast}
                />
              )}
            </>
          ) : null}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-stone-200 dark:border-zinc-800 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {NAV.filter((item) => item.mobile).map((item) => {
            const Icon = item.icon;
            const active = item.id === route;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium cursor-pointer',
                  active ? 'text-rose-900 dark:text-rose-400' : 'text-stone-500 dark:text-zinc-400',
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </nav>

      {toast && (
        <div className="no-print fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md">
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg border',
              toast.kind === 'success' &&
                'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
              toast.kind === 'error' &&
                'bg-red-50 dark:bg-red-950/90 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200',
              toast.kind === 'info' &&
                'bg-white dark:bg-zinc-900 border-stone-200 dark:border-zinc-700 text-stone-800 dark:text-zinc-200',
            )}
            role="status"
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-current mt-2 shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {loadingBoot && boot && (
        <div className="no-print fixed top-3 right-3 z-40 rounded-full bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700 px-3 py-1.5 shadow-sm">
          <Spinner label="Syncing" />
        </div>
      )}
    </div>
  );
}
