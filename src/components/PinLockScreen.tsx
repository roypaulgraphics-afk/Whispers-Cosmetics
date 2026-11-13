import React, { useEffect, useState } from 'react';
import { Delete, Lock, Moon, Sun } from 'lucide-react';
import { StoreSettings } from '../types';

interface PinLockScreenProps {
  settings: StoreSettings;
  onUnlock: () => void;
  onToggleTheme: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  settings,
  onUnlock,
  onToggleTheme,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitPin = async (code: string) => {
    if (code.length !== 4 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: code }),
      });
      if (res.ok) {
        onUnlock();
      } else {
        setError('Incorrect PIN. Please try again.');
        setPinInput('');
      }
    } catch {
      if (code === settings.pin) {
        onUnlock();
      } else {
        setError('Incorrect PIN. Please try again.');
        setPinInput('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDigit = (digit: string) => {
    if (pinInput.length >= 4 || submitting) return;
    const next = pinInput + digit;
    setPinInput(next);
    setError('');
    if (next.length === 4) {
      void submitPin(next);
    }
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
    setError('');
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && pinInput.length === 4) {
        void submitPin(pinInput);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 p-6 transition-colors duration-200">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
          aria-label="Toggle light or dark mode"
        >
          {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{settings.theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>

      <div className="w-full max-w-sm mx-auto my-auto bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl p-8">
        <div className="flex flex-col items-center text-center mb-8">
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={`${settings.storeName} Logo`}
              className="w-16 h-16 rounded-xl object-cover border border-stone-200 dark:border-zinc-700 mb-4"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-rose-900 dark:bg-rose-800 text-white flex items-center justify-center mb-4">
              <span className="font-display text-2xl font-semibold tracking-wide">WC</span>
            </div>
          )}
          <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-900 dark:text-zinc-50">
            {settings.storeName}
          </h1>
          <p className="mt-1.5 text-sm text-stone-500 dark:text-zinc-400">
            Enter 4-digit staff PIN to open register
          </p>
        </div>

        {/* PIN indicators */}
        <div className="flex items-center justify-center gap-4 mb-6" aria-label="PIN entry progress">
          {[0, 1, 2, 3].map((idx) => {
            const filled = idx < pinInput.length;
            return (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                  filled
                    ? 'bg-rose-900 dark:bg-rose-500 scale-110'
                    : 'border border-stone-300 dark:border-zinc-700 bg-transparent'
                }`}
              />
            );
          })}
        </div>

        {error ? (
          <p className="text-center text-xs font-medium text-red-600 dark:text-red-400 mb-4" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-center text-xs text-stone-400 dark:text-zinc-500 mb-4">
            Default PIN: <span className="font-mono-num text-stone-600 dark:text-zinc-300">1234</span>
          </p>
        )}

        {/* Tactile Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5">
          {digits.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              disabled={submitting}
              className="h-13 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-[0.98] text-lg font-medium font-mono-num text-stone-900 dark:text-zinc-100 transition-all cursor-pointer"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPinInput('');
              setError('');
            }}
            className="h-13 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-500 dark:text-zinc-400 transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={submitting}
            className="h-13 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-[0.98] text-lg font-medium font-mono-num text-stone-900 dark:text-zinc-100 transition-all cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            aria-label="Delete digit"
            className="h-13 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/60 hover:bg-stone-100 dark:hover:bg-zinc-800 flex items-center justify-center text-stone-600 dark:text-zinc-300 transition-colors cursor-pointer"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-stone-400 dark:text-zinc-500">
        <Lock className="w-3.5 h-3.5" />
        <span>PIN-protected session · Change PIN anytime in Store Settings</span>
      </div>
    </div>
  );
};
