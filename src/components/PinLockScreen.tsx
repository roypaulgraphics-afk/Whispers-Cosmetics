import React, { useEffect, useState } from 'react';
import { Delete, Lock, Moon, Sun } from 'lucide-react';
import type { SessionInfo } from '../types';
import { api, ApiError } from '../lib/api';
import { initials } from '../lib/format';

interface PinLockScreenProps {
  storeName: string;
  logoUrl: string;
  theme: 'light' | 'dark';
  onUnlocked: (session: SessionInfo) => void;
  onToggleTheme: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  storeName,
  logoUrl,
  theme,
  onUnlocked,
  onToggleTheme,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (code: string) => {
    if (code.length !== 4 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const session = await api<SessionInfo>('/api/auth/login', {
        method: 'POST',
        body: { pin: code },
        silent401: true,
      });
      onUnlocked(session);
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.status === 429
            ? caught.message
            : 'Incorrect PIN. Please try again.'
          : 'Cannot reach the store server.';
      setError(message);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const press = (digit: string) => {
    if (submitting || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === 4) void submit(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (submitting) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') setPin((current) => current.slice(0, -1));
      else if (event.key === 'Enter' && pin.length === 4) void submit(pin);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen w-full flex flex-col bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 p-6 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-zinc-500">
          <Lock className="w-3.5 h-3.5" />
          <span>Secure register</span>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>

      <div className="w-full max-w-sm mx-auto my-auto">
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm">
          <div className="flex flex-col items-center text-center mb-7">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${storeName} logo`}
                className="w-16 h-16 rounded-xl object-cover border border-stone-200 dark:border-zinc-700 mb-4"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-rose-900 dark:bg-rose-800 text-white flex items-center justify-center mb-4 font-display text-2xl font-semibold">
                {initials(storeName) || 'WC'}
              </div>
            )}
            <h1 className="font-display text-3xl font-semibold tracking-tight">{storeName}</h1>
            <p className="mt-1.5 text-sm text-stone-500 dark:text-zinc-400">
              Enter your 4-digit staff PIN to open the register
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 mb-5" aria-label="PIN progress">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`w-3.5 h-3.5 rounded-full transition-all ${
                  index < pin.length
                    ? 'bg-rose-900 dark:bg-rose-500 scale-110'
                    : 'border border-stone-300 dark:border-zinc-700'
                }`}
              />
            ))}
          </div>

          <div className="h-6 mb-2">
            {error ? (
              <p className="text-center text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            ) : submitting ? (
              <p className="text-center text-xs text-stone-400 dark:text-zinc-500">Checking PIN…</p>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {digits.map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => press(digit)}
                disabled={submitting}
                className="h-12 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-[0.98] text-lg font-medium font-mono-num transition-all cursor-pointer disabled:opacity-50"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPin('');
                setError('');
              }}
              className="h-12 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-500 dark:text-zinc-400 cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => press('0')}
              disabled={submitting}
              className="h-12 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-[0.98] text-lg font-medium font-mono-num cursor-pointer disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setPin((current) => current.slice(0, -1))}
              aria-label="Delete digit"
              className="h-12 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center justify-center text-stone-600 dark:text-zinc-300 cursor-pointer"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-stone-400 dark:text-zinc-500 mt-5">
          Forgot the PIN? The store owner can reset it by following the README recovery steps.
        </p>
      </div>
    </div>
  );
};
