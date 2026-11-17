import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  DatabaseBackup,
  Download,
  ImagePlus,
  KeyRound,
  Lock,
  Moon,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react';
import type { AppMeta, MpesaInfo, StoreSettings } from '../types';
import { api } from '../lib/api';
import { cn, dateTime, dateOnly } from '../lib/format';
import { processUploadedImage } from '../lib/imageUpload';
import { Badge, Button, SectionHeading, Spinner } from './ui';

interface SettingsViewProps {
  settings: StoreSettings;
  meta: AppMeta;
  mpesa: MpesaInfo;
  onSettingsChange: (settings: StoreSettings) => void;
  onLogout: () => Promise<void>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  meta,
  mpesa,
  onSettingsChange,
  onLogout,
  showToast,
}) => {
  const [form, setForm] = useState({
    storeName: settings.storeName,
    currency: settings.currency,
    mpesaTillNumber: settings.mpesaTillNumber,
    receiptFooter: settings.receiptFooter,
    logoUrl: settings.logoUrl,
    autoDynamicEnabled: settings.autoDynamicEnabled,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMessage, setPinMessage] = useState('');

  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');

  const [themeBusy, setThemeBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    setForm({
      storeName: settings.storeName,
      currency: settings.currency,
      mpesaTillNumber: settings.mpesaTillNumber,
      receiptFooter: settings.receiptFooter,
      logoUrl: settings.logoUrl,
      autoDynamicEnabled: settings.autoDynamicEnabled,
    });
  }, [
    settings.storeName,
    settings.currency,
    settings.mpesaTillNumber,
    settings.receiptFooter,
    settings.logoUrl,
    settings.autoDynamicEnabled,
  ]);

  const loadBackups = useCallback(async () => {
    setBackupError('');
    try {
      const result = await api<{ backups: BackupInfo[] }>('/api/backups');
      setBackups(result.backups);
    } catch (error) {
      setBackups([]);
      setBackupError(error instanceof Error ? error.message : 'Could not load backups.');
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.storeName.trim().length < 2) {
      showToast('Enter the business name.', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ settings: StoreSettings }>('/api/settings', {
        method: 'PATCH',
        body: {
          storeName: form.storeName.trim(),
          currency: form.currency.trim() || 'Ksh',
          mpesaTillNumber: form.mpesaTillNumber.trim(),
          receiptFooter: form.receiptFooter.trim(),
          logoUrl: form.logoUrl,
          autoDynamicEnabled: form.autoDynamicEnabled,
        },
      });
      onSettingsChange(result.settings);
      showToast('Store settings saved.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      showToast('Choose a PNG, JPEG or WEBP image.', 'error');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await processUploadedImage(file, 360);
      const result = await api<{ url: string }>('/api/uploads', {
        method: 'POST',
        body: { dataUrl, kind: 'logo' },
      });
      setForm((current) => ({ ...current, logoUrl: result.url }));
      showToast('Logo uploaded. Save to apply it everywhere.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Logo upload failed.', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changeTheme = async (theme: 'light' | 'dark') => {
    if (theme === settings.theme) return;
    setThemeBusy(true);
    try {
      const result = await api<{ settings: StoreSettings }>('/api/settings', {
        method: 'PATCH',
        body: { theme },
      });
      onSettingsChange(result.settings);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not change the theme.', 'error');
    } finally {
      setThemeBusy(false);
    }
  };

  const submitPin = async (event: React.FormEvent) => {
    event.preventDefault();
    setPinMessage('');
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      showToast('PINs must be exactly 4 digits.', 'error');
      return;
    }
    if (newPin !== confirmPin) {
      showToast('The new PIN and confirmation do not match.', 'error');
      return;
    }
    if (newPin === currentPin) {
      showToast('Choose a new PIN that differs from the current one.', 'error');
      return;
    }
    setPinBusy(true);
    try {
      const result = await api<{ deletedSessions: number }>('/api/settings/pin', {
        method: 'POST',
        body: { currentPin, newPin },
      });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      onSettingsChange({ ...settings, pinIsDefault: false });
      setPinMessage(
        result.deletedSessions > 0
          ? `PIN updated. Signed out ${result.deletedSessions} other session(s).`
          : 'PIN updated. Keep it safe.',
      );
      showToast('Staff PIN changed.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not change the PIN.', 'error');
    } finally {
      setPinBusy(false);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    setBackupError('');
    try {
      await api<{ backup: BackupInfo }>('/api/backups', { method: 'POST' });
      await loadBackups();
      showToast('Backup created.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Backup failed.', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <SectionHeading
        title="Store settings"
        description="Branding, security, M-Pesa and backups for this register."
        action={
          <Button
            variant="secondary"
            onClick={async () => {
              setLogoutBusy(true);
              try {
                await onLogout();
              } finally {
                setLogoutBusy(false);
              }
            }}
            loading={logoutBusy}
          >
            <Lock className="w-4 h-4" /> Lock register
          </Button>
        }
      />

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-rose-900 dark:text-rose-400" />
            <h2 className="font-display text-xl font-semibold">Store profile</h2>
          </div>
          <form onSubmit={(event) => void saveProfile(event)} className="space-y-3">
            <div className="flex items-center gap-4">
              {form.logoUrl ? (
                <div className="relative">
                  <img
                    src={form.logoUrl}
                    alt="Store logo"
                    className="w-16 h-16 rounded-xl object-cover border border-stone-200 dark:border-zinc-700"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, logoUrl: '' }))}
                    className="absolute -top-2 -right-2 p-1 rounded-full bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-red-600 shadow-sm cursor-pointer"
                    aria-label="Remove logo"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-16 h-16 rounded-xl border border-dashed border-stone-300 dark:border-zinc-700 flex items-center justify-center text-stone-400 hover:border-rose-400 hover:text-rose-800 cursor-pointer"
                  aria-label="Upload logo"
                >
                  {uploading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                </button>
              )}
              <div className="text-xs text-stone-500 dark:text-zinc-400">
                <p className="font-medium text-stone-700 dark:text-zinc-200">Business logo</p>
                <p className="mt-0.5">Shown on receipts and in the sidebar. PNG, JPEG or WEBP.</p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-1 font-medium text-rose-900 dark:text-rose-400 underline underline-offset-2 cursor-pointer"
                >
                  {form.logoUrl ? 'Replace image' : 'Choose image'}
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void uploadLogo(event.target.files?.[0])}
                className="hidden"
              />
            </div>

            <label className="block text-xs font-medium">
              Business name
              <input
                type="text"
                value={form.storeName}
                onChange={(event) => setForm((current) => ({ ...current, storeName: event.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium">
                Currency symbol
                <input
                  type="text"
                  maxLength={8}
                  value={form.currency}
                  onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </label>
              <label className="block text-xs font-medium">
                M-Pesa till number
                <input
                  type="text"
                  value={form.mpesaTillNumber}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, mpesaTillNumber: event.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </label>
            </div>
            <label className="block text-xs font-medium">
              Receipt footer
              <textarea
                rows={3}
                value={form.receiptFooter}
                onChange={(event) => setForm((current) => ({ ...current, receiptFooter: event.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
              />
            </label>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.autoDynamicEnabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, autoDynamicEnabled: event.target.checked }))
                }
                className="accent-rose-900 mt-0.5"
              />
              <span>
                Enable dynamic pricing suggestions
                <span className="block text-[11px] text-stone-500 dark:text-zinc-400">
                  Shows recommended price changes on the overview based on demand and expiry.
                </span>
              </span>
            </label>
            <Button type="submit" loading={saving}>
              <Save className="w-4 h-4" /> Save profile
            </Button>
          </form>
        </section>

        <div className="space-y-5">
          <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="flex items-center gap-2 mb-4">
              {settings.theme === 'dark' ? (
                <Moon className="w-4 h-4 text-sky-400" />
              ) : (
                <Sun className="w-4 h-4 text-amber-600" />
              )}
              <h2 className="font-display text-xl font-semibold">Appearance</h2>
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mb-3">
              The theme applies to every device after the next sign-in and is remembered on this one.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['light', 'dark'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void changeTheme(option)}
                  disabled={themeBusy || settings.theme === option}
                  className={cn(
                    'rounded-lg border px-3 py-3 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60',
                    settings.theme === option
                      ? 'border-rose-800 bg-rose-50 text-rose-900 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-200'
                      : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800',
                  )}
                >
                  {option === 'light' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {option === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-rose-900 dark:text-rose-400" />
              <h2 className="font-display text-xl font-semibold">Security</h2>
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mb-3">
              4-digit staff PIN protects this register. Changing it signs out every other device.
            </p>
            {settings.pinIsDefault && (
              <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                This register still uses the default PIN. Set a new one now.
              </div>
            )}
            <form onSubmit={(event) => void submitPin(event)} className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-[11px] font-medium">
                  Current
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={currentPin}
                    onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-center font-mono tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                  />
                </label>
                <label className="block text-[11px] font-medium">
                  New PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-center font-mono tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                  />
                </label>
                <label className="block text-[11px] font-medium">
                  Confirm
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
                    className="mt-1 w-full px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-center font-mono tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                  />
                </label>
              </div>
              {pinMessage && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {pinMessage}
                </p>
              )}
              <Button type="submit" loading={pinBusy} disabled={!currentPin || !newPin || !confirmPin}>
                <KeyRound className="w-4 h-4" /> Change PIN
              </Button>
            </form>
          </section>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <h2 className="font-display text-xl font-semibold">M-Pesa / Daraja</h2>
            </div>
            <Badge tone={mpesa.configured ? 'green' : 'amber'}>
              {mpesa.configured ? `Live · ${mpesa.environment}` : 'Not configured'}
            </Badge>
          </div>
          <dl className="text-xs space-y-2">
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500 dark:text-zinc-400">STK Push</dt>
              <dd>{mpesa.configured ? 'Enabled' : 'Unavailable'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500 dark:text-zinc-400">Shortcode</dt>
              <dd className="font-mono">{mpesa.shortcode ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500 dark:text-zinc-400">Manual SMS confirmation</dt>
              <dd>{mpesa.manualEnabled ? 'Allowed' : 'Disabled'}</dd>
            </div>
          </dl>
          {mpesa.reason && (
            <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
              {mpesa.reason}
            </p>
          )}
          <div className="mt-3 text-[11px] text-stone-500 dark:text-zinc-400 space-y-1">
            <p>Daraja is configured with server environment variables — never in the browser:</p>
            <p className="font-mono text-[10px] leading-relaxed">
              MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_ENVIRONMENT,
              MPESA_CALLBACK_URL, MPESA_CALLBACK_SECRET
            </p>
            <p>
              Set <span className="font-mono">MANUAL_MPESA_ENABLED=false</span> to force STK Push only.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4 text-sky-700 dark:text-sky-400" />
              <h2 className="font-display text-xl font-semibold">Backups</h2>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void createBackup()} loading={backupBusy}>
              <DatabaseBackup className="w-3.5 h-3.5" /> Backup now
            </Button>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-zinc-400 mb-3">
            A snapshot is taken automatically every 24 hours and kept for 14 days. Creating one now is safe while the
            register is in use.
          </p>
          {backups === null ? (
            <Spinner label="Loading backups…" className="py-6" />
          ) : backupError ? (
            <p className="text-[11px] text-red-600 dark:text-red-400">{backupError}</p>
          ) : backups.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-zinc-400">No backups yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-zinc-800 max-h-56 overflow-y-auto">
              {backups.map((backup) => (
                <li key={backup.name} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono truncate">{backup.name}</p>
                    <p className="text-[10px] text-stone-400">
                      {dateTime(backup.createdAt)} · {formatBytes(backup.size)}
                    </p>
                  </div>
                  <a
                    href={`/api/backups/${encodeURIComponent(backup.name)}/download`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-900 dark:text-rose-400 hover:underline shrink-0"
                    onClick={() => showToast('Download started.', 'info')}
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-stone-400" />
          <h2 className="font-display text-xl font-semibold">About this register</h2>
        </div>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <dt className="text-stone-500 dark:text-zinc-400">Version</dt>
            <dd className="font-mono mt-0.5">{meta.version}</dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-zinc-400">Timezone</dt>
            <dd className="font-mono mt-0.5">{meta.timezone}</dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-zinc-400">Business date</dt>
            <dd className="font-mono mt-0.5">{dateOnly(meta.today)}</dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-zinc-400">Server time</dt>
            <dd className="font-mono mt-0.5">{dateTime(meta.serverTime)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[11px] text-stone-400 dark:text-zinc-500">
          {meta.appName} · data is stored locally in SQLite and backed up on the server. Sales, refunds, stock and
          settings changes are all recorded in the audit trail.
        </p>
      </section>
    </div>
  );
};
