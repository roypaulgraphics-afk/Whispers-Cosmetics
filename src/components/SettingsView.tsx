import React, { useState } from 'react';
import { Check, KeyRound, Moon, Store, Sun, Trash2, Upload } from 'lucide-react';
import { StoreSettings } from '../types';
import { processUploadedImage } from '../lib/imageUpload';

interface SettingsViewProps {
  settings: StoreSettings;
  onSaveSettings: (partial: Partial<StoreSettings>) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSaveSettings }) => {
  const [storeName, setStoreName] = useState(settings.storeName);
  const [mpesaTill, setMpesaTill] = useState(settings.mpesaTillNumber);
  const [currency, setCurrency] = useState(settings.currency);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await processUploadedImage(file, 360);
      setLogoUrl(dataUrl);
      await onSaveSettings({ logoUrl: dataUrl });
      setStatusMsg('Whispers Cosmetics logo updated.');
      setErrorMsg('');
    } catch {
      setErrorMsg('Unable to process logo file.');
    }
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    if (newPin || confirmPin) {
      if (!/^\d{4}$/.test(newPin)) {
        setErrorMsg('New PIN must be exactly 4 digits.');
        return;
      }
      if (newPin !== confirmPin) {
        setErrorMsg('PIN confirmation does not match.');
        return;
      }
    }

    await onSaveSettings({
      storeName: storeName.trim() || 'Whispers Cosmetics',
      mpesaTillNumber: mpesaTill.trim() || '5482910',
      currency: currency.trim() || 'Ksh',
      logoUrl,
      ...(newPin ? { pin: newPin } : {}),
    });

    setNewPin('');
    setConfirmPin('');
    setStatusMsg('Store settings saved successfully.');
  };

  return (
    <div className="max-w-3xl space-y-6">
      {statusMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs font-medium text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Brand Logo Upload */}
      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-rose-900 dark:text-rose-400" />
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            Brand Identity &amp; Custom Logo
          </h2>
        </div>
        <p className="text-xs text-stone-500 dark:text-zinc-400">
          Upload your Whispers Cosmetics shop logo. It appears in the navigation sidebar and PIN lock screen.
        </p>

        <div className="flex flex-wrap items-center gap-5">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Whispers Cosmetics Logo"
              className="w-20 h-20 rounded-xl object-cover border border-stone-200 dark:border-zinc-700"
            />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-rose-900 dark:bg-rose-800 text-white flex items-center justify-center">
              <span className="font-display text-2xl font-semibold">WC</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer hover:bg-stone-800 dark:hover:bg-zinc-200 transition-colors">
              <Upload className="w-4 h-4" />
              <span>Upload Logo Image</span>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
            </label>

            {logoUrl && (
              <button
                type="button"
                onClick={() => {
                  setLogoUrl('');
                  void onSaveSettings({ logoUrl: '' });
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-600 dark:text-zinc-300 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Logo</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Store Details, Theme & PIN */}
      <form
        onSubmit={handleSaveGeneral}
        className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
              Business Name
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
              Currency Symbol
            </label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
              M-Pesa Till / Paybill Number
            </label>
            <input
              type="text"
              value={mpesaTill}
              onChange={(e) => setMpesaTill(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
              Display Theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onSaveSettings({ theme: 'light' })}
                className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-rose-900 border-rose-900 text-white'
                    : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Light Mode</span>
              </button>
              <button
                type="button"
                onClick={() => void onSaveSettings({ theme: 'dark' })}
                className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-rose-700 border-rose-700 text-white'
                    : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Dark Mode</span>
              </button>
            </div>
          </div>
        </div>

        {/* Change 4-digit PIN */}
        <div className="pt-4 border-t border-stone-100 dark:border-zinc-800 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Change Register PIN
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New 4-digit PIN"
              className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm new PIN"
              className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Save Store Settings
          </button>
        </div>
      </form>
    </div>
  );
};
