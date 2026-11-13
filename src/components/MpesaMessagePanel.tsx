import React, { useState } from 'react';
import { CheckCircle2, ClipboardPaste, MessageSquareText, Smartphone, AlertTriangle } from 'lucide-react';
import { MpesaDetails } from '../types';
import { generateSimulatedMpesaSms, parseMpesaMessage } from '../lib/mpesaParser';

interface MpesaMessagePanelProps {
  expectedAmount: number;
  tillNumber: string;
  value: string;
  onChange: (rawMessage: string, parsed: MpesaDetails, isValid: boolean) => void;
}

export const MpesaMessagePanel: React.FC<MpesaMessagePanelProps> = ({
  expectedAmount,
  tillNumber,
  value,
  onChange,
}) => {
  const [clipboardStatus, setClipboardStatus] = useState<string>('');
  const [showInbox, setShowInbox] = useState(false);

  const parsedResult = parseMpesaMessage(value, expectedAmount);

  const handleTextChange = (raw: string) => {
    const res = parseMpesaMessage(raw, expectedAmount);
    onChange(raw, res.details, res.valid);
  };

  const handlePasteFromClipboard = async () => {
    setClipboardStatus('');
    try {
      if (!navigator.clipboard?.readText) {
        setClipboardStatus('Clipboard access requires HTTPS or manual paste (Ctrl+V).');
        return;
      }
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        setClipboardStatus('Clipboard is empty. Copy an M-Pesa confirmation SMS first.');
        return;
      }
      handleTextChange(clipText);
      setClipboardStatus('M-Pesa message imported from clipboard.');
    } catch {
      setClipboardStatus('Browser blocked automatic clipboard read. Paste message below.');
    }
  };

  const sampleMessages = [
    generateSimulatedMpesaSms(expectedAmount, tillNumber, 'FAITH MUTISO', '0724819302'),
    generateSimulatedMpesaSms(expectedAmount, tillNumber, 'ESTHER WANJIRU', '0715390411'),
  ];

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            M-Pesa Confirmation Message Access (Till {tillNumber})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Read Clipboard SMS</span>
          </button>
          <button
            type="button"
            onClick={() => setShowInbox((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            <span>{showInbox ? 'Hide SMS Inbox' : 'Access M-Pesa SMS'}</span>
          </button>
        </div>
      </div>

      {clipboardStatus && (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">{clipboardStatus}</p>
      )}

      {showInbox && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-white dark:bg-zinc-900 p-2.5 space-y-2">
          <p className="text-xs font-medium text-stone-600 dark:text-zinc-400">
            Select incoming M-Pesa Till SMS to attach &amp; verify:
          </p>
          {sampleMessages.map((msg, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                handleTextChange(msg);
                setShowInbox(false);
              }}
              className="w-full text-left p-2.5 rounded-lg border border-stone-200 dark:border-zinc-800 hover:border-emerald-400 dark:hover:border-emerald-600 bg-stone-50 dark:bg-zinc-950 text-xs text-stone-700 dark:text-zinc-300 leading-relaxed transition-colors cursor-pointer"
            >
              {msg}
            </button>
          ))}
        </div>
      )}

      <textarea
        rows={3}
        value={value}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder="Paste M-Pesa confirmation message here (e.g. UK49L82TXA Confirmed. Ksh1,500.00 received from...)"
        className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
      />

      {/* Live verification readout */}
      {value.trim() && (
        <div
          className={`rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
            parsedResult.valid
              ? 'bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200'
              : 'bg-amber-100/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
          }`}
        >
          {parsedResult.valid ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          )}
          <div className="space-y-0.5">
            {parsedResult.details.transactionCode && (
              <div className="font-medium">
                Code: <span className="font-mono-num">{parsedResult.details.transactionCode}</span>
                {' · '}
                Amount: <span className="font-mono-num">Ksh {parsedResult.details.amountReceived.toLocaleString()}</span>
                {parsedResult.details.senderName ? ` · From: ${parsedResult.details.senderName}` : ''}
              </div>
            )}
            {parsedResult.reason && <div>{parsedResult.reason}</div>}
          </div>
        </div>
      )}
    </div>
  );
};
