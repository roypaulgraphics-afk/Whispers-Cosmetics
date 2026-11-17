import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Pencil,
  Phone,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react';
import type { CreditRecord, MpesaDetails, MpesaInfo, MpesaIntentStatus, StoreSettings } from '../types';
import { api } from '../lib/api';
import { computeCreditStatus } from '../lib/dynamicPricing';
import { cn, dateOnly, dateTime, money, moneyExact } from '../lib/format';
import { Badge, Button, EmptyState, Modal, SectionHeading, StatCard } from './ui';
import { MpesaMessagePanel } from './MpesaMessagePanel';

interface CreditPendingViewProps {
  credits: CreditRecord[];
  settings: StoreSettings;
  mpesa: MpesaInfo;
  onRefresh: () => Promise<void>;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

type CreditTab = 'all' | 'Pending' | 'Partial' | 'Overdue' | 'Paid';

const TABS: CreditTab[] = ['all', 'Pending', 'Partial', 'Overdue', 'Paid'];

export const CreditPendingView: React.FC<CreditPendingViewProps> = ({
  credits,
  settings,
  mpesa,
  onRefresh,
  showToast,
}) => {
  const currency = settings.currency;
  const [tab, setTab] = useState<CreditTab>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<CreditRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'Cash' | 'Mpesa'>('Cash');
  const [payMpesaMode, setPayMpesaMode] = useState<'stk' | 'manual'>('stk');
  const [payManual, setPayManual] = useState<{ raw: string; details: MpesaDetails; valid: boolean } | null>(null);
  const [payNote, setPayNote] = useState('');
  const [payIntent, setPayIntent] = useState<{ id: string; status: string; message: string; receipt?: string } | null>(null);
  const [stkBusy, setStkBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  const [editTarget, setEditTarget] = useState<CreditRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const balanceOf = (credit: CreditRecord) => Math.max(0, credit.totalAmount - credit.amountPaid);

  const enriched = useMemo(
    () =>
      credits.map((credit) => ({
        credit,
        balance: balanceOf(credit),
        status: computeCreditStatus(credit) as 'Pending' | 'Partial' | 'Overdue' | 'Paid',
      })),
    [credits],
  );

  const stats = useMemo(() => {
    const open = enriched.filter((entry) => entry.status !== 'Paid');
    return {
      outstanding: open.reduce((sum, entry) => sum + entry.balance, 0),
      overdue: open.filter((entry) => entry.status === 'Overdue').reduce((sum, entry) => sum + entry.balance, 0),
      customers: open.length,
      collected: credits.reduce(
        (sum, credit) => sum + credit.payments.reduce((paid, payment) => paid + payment.amount, 0),
        0,
      ),
    };
  }, [enriched, credits]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enriched.filter((entry) => {
      if (tab !== 'all' && entry.status !== tab) return false;
      if (!term) return true;
      return (
        entry.credit.creditorName.toLowerCase().includes(term) ||
        entry.credit.creditorPhone.toLowerCase().includes(term) ||
        entry.credit.notes.toLowerCase().includes(term)
      );
    });
  }, [enriched, tab, search]);

  useEffect(() => {
    if (!payIntent || payIntent.status !== 'pending') return;
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api<{ intent: MpesaIntentStatus }>(`/api/mpesa/status/${payIntent.id}`);
        if (cancelled) return;
        if (result.intent.status !== 'pending') {
          setPayIntent({
            id: result.intent.id,
            status: result.intent.status,
            message: result.intent.resultDesc ?? '',
            receipt: result.intent.mpesaReceipt ?? undefined,
          });
          return;
        }
        attempts += 1;
        if (attempts < 60) timer = window.setTimeout(() => void poll(), 3000);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 4000);
      }
    };

    timer = window.setTimeout(() => void poll(), 2200);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [payIntent?.id, payIntent?.status]);

  const openPayment = (credit: CreditRecord, method: 'Cash' | 'Mpesa' = 'Cash') => {
    setPayTarget(credit);
    setPayAmount(String(balanceOf(credit)));
    setPayMethod(method);
    setPayMpesaMode(mpesa.configured ? 'stk' : 'manual');
    setPayManual(null);
    setPayNote('');
    setPayIntent(null);
  };

  const closePayment = () => {
    setPayTarget(null);
    setPayAmount('');
    setPayManual(null);
    setPayNote('');
    setPayIntent(null);
  };

  const openEdit = (credit: CreditRecord) => {
    setEditTarget(credit);
    setEditName(credit.creditorName);
    setEditPhone(credit.creditorPhone);
    setEditDue(credit.dueDate);
    setEditNotes(credit.notes);
  };

  const amountValue = Number.parseFloat(payAmount) || 0;
  const targetBalance = payTarget ? balanceOf(payTarget) : 0;
  const payManualDetails = payManual?.valid ? payManual.details : null;

  const startPaymentStk = async () => {
    if (!payTarget) return;
    const phone = payTarget.creditorPhone;
    if (!phone) {
      showToast('Add the customer’s phone number before requesting M-Pesa.', 'error');
      return;
    }
    if (amountValue <= 0 || amountValue > targetBalance) {
      showToast('Enter an amount within the outstanding balance.', 'error');
      return;
    }
    if (!Number.isInteger(amountValue)) {
      showToast('STK Push needs a whole-shilling amount.', 'error');
      return;
    }
    setStkBusy(true);
    try {
      const result = await api<{ intentId: string; status: string; message: string }>('/api/mpesa/stkpush', {
        method: 'POST',
        body: {
          phone,
          amount: amountValue,
          purpose: 'credit',
          accountReference: payTarget.creditorName,
        },
      });
      setPayIntent({ id: result.intentId, status: result.status, message: result.message });
      showToast('STK Push sent to the customer.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send the STK Push.', 'error');
    } finally {
      setStkBusy(false);
    }
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    if (amountValue <= 0) {
      showToast('Enter the payment amount.', 'error');
      return;
    }
    if (amountValue > targetBalance + 0.001) {
      showToast(`The balance is only ${moneyExact(targetBalance, currency)}.`, 'error');
      return;
    }
    if (payMethod === 'Mpesa') {
      if (payMpesaMode === 'stk' && payIntent?.status !== 'success') {
        showToast('Wait for the M-Pesa payment to be confirmed.', 'error');
        return;
      }
      if (payMpesaMode === 'manual' && !payManualDetails) {
        showToast('Attach a valid M-Pesa confirmation message.', 'error');
        return;
      }
    }
    setPaying(true);
    try {
      await api(`/api/credits/${payTarget.id}/payments`, {
        method: 'POST',
        body: {
          amount: amountValue,
          method: payMethod,
          note: payNote.trim() || undefined,
          mpesa:
            payMethod === 'Mpesa'
              ? payMpesaMode === 'stk'
                ? { intentId: payIntent?.id }
                : {
                    transactionCode: payManualDetails?.transactionCode,
                    amountReceived: payManualDetails?.amountReceived,
                    senderName: payManualDetails?.senderName,
                    senderPhone: payManualDetails?.senderPhone,
                    rawMessage: payManualDetails?.rawMessage,
                  }
              : undefined,
        },
      });
      await onRefresh();
      showToast(`Payment of ${money(amountValue, currency)} recorded for ${payTarget.creditorName}.`);
      closePayment();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not record the payment.', 'error');
    } finally {
      setPaying(false);
    }
  };

  const submitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await api(`/api/credits/${editTarget.id}`, {
        method: 'PATCH',
        body: {
          customerName: editName.trim(),
          customerPhone: editPhone.trim(),
          dueDate: editDue,
          notes: editNotes.trim(),
        },
      });
      await onRefresh();
      showToast('Credit account updated.');
      setEditTarget(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the credit account.', 'error');
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Credits & pending"
        description="Track customer balances, due dates and payments."
        action={
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer or phone…"
              className="pl-3 pr-3 py-2 w-56 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Outstanding"
          value={money(stats.outstanding, currency)}
          sub={`${stats.customers} open account(s)`}
          icon={<CreditCard className="w-4 h-4" />}
          accent="amber"
        />
        <StatCard
          label="Overdue"
          value={money(stats.overdue, currency)}
          sub="Past the agreed due date"
          icon={<AlertTriangle className="w-4 h-4" />}
          accent="rose"
        />
        <StatCard
          label="Collected"
          value={money(stats.collected, currency)}
          sub="All recorded credit payments"
          icon={<Wallet className="w-4 h-4" />}
          accent="emerald"
        />
        <StatCard
          label="Customers"
          value={String(stats.customers)}
          sub="With an open balance"
          icon={<Users className="w-4 h-4" />}
          accent="sky"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => {
          const count =
            entry === 'all' ? enriched.length : enriched.filter((item) => item.status === entry).length;
          return (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={cn(
                'px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer',
                tab === entry
                  ? 'bg-rose-900 border-rose-900 text-white'
                  : 'border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800',
              )}
            >
              {entry === 'all' ? 'All accounts' : entry} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <EmptyState
            icon={<CreditCard className="w-5 h-5" />}
            title="No credit accounts here"
            description="Credit sales made at the register appear here until they are fully paid."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ credit, balance, status }) => {
            const isOpen = expanded === credit.id;
            const totalPaid = credit.totalAmount - balance;
            const progress = credit.totalAmount > 0 ? Math.min(100, (totalPaid / credit.totalAmount) * 100) : 0;
            return (
              <div
                key={credit.id}
                className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate">{credit.creditorName}</h3>
                        <Badge
                          tone={
                            status === 'Paid'
                              ? 'green'
                              : status === 'Overdue'
                                ? 'red'
                                : status === 'Partial'
                                  ? 'blue'
                                  : 'amber'
                          }
                        >
                          {status}
                        </Badge>
                        {credit.saleId && <Badge tone="neutral">Linked sale</Badge>}
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        {credit.creditorPhone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {credit.creditorPhone}
                          </span>
                        )}
                        <span>Due {dateOnly(credit.dueDate)}</span>
                        <span>{credit.items.length} item line(s)</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg font-semibold">{money(balance, currency)}</p>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                        of {money(credit.totalAmount, currency)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        status === 'Paid' ? 'bg-emerald-600' : status === 'Overdue' ? 'bg-red-600' : 'bg-rose-800',
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-stone-400 dark:text-zinc-500">
                    <span>Paid {money(totalPaid, currency)}</span>
                    <span>{credit.payments.length} payment(s)</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {status !== 'Paid' && (
                      <>
                        <Button size="sm" onClick={() => openPayment(credit, 'Cash')}>
                          <Wallet className="w-3.5 h-3.5" /> Record payment
                        </Button>
                        {mpesa.configured && credit.creditorPhone && (
                          <Button size="sm" variant="secondary" onClick={() => openPayment(credit, 'Mpesa')}>
                            <Smartphone className="w-3.5 h-3.5" /> Request M-Pesa
                          </Button>
                        )}
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(credit)}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : credit.id)}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      {isOpen ? 'Hide details' : 'Details'}
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-stone-100 dark:border-zinc-800 bg-stone-50/60 dark:bg-zinc-950/30 px-4 py-3 grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider font-semibold text-stone-500 dark:text-zinc-400 mb-1.5">
                        Items on credit
                      </p>
                      <ul className="space-y-1">
                        {credit.items.map((item, index) => (
                          <li key={item.id ?? `${item.productId}-${index}`} className="flex justify-between text-xs">
                            <span className="truncate pr-2">
                              {item.productName} × {item.quantity}
                            </span>
                            <span className="font-mono">{moneyExact(item.unitPrice * item.quantity, currency)}</span>
                          </li>
                        ))}
                      </ul>
                      {credit.notes && (
                        <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-2 whitespace-pre-line">
                          {credit.notes}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider font-semibold text-stone-500 dark:text-zinc-400 mb-1.5">
                        Payment history
                      </p>
                      {credit.payments.length === 0 ? (
                        <p className="text-xs text-stone-500 dark:text-zinc-400">No payments recorded yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {credit.payments.map((payment) => (
                            <li key={payment.id} className="flex items-start justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <p className="font-medium">
                                  {payment.method}
                                  {payment.mpesaDetails?.transactionCode && (
                                    <span className="ml-1 font-mono text-[10px] text-stone-500">
                                      {payment.mpesaDetails.transactionCode}
                                    </span>
                                  )}
                                </p>
                                <p className="text-[10px] text-stone-400 dark:text-zinc-500">
                                  {dateTime(payment.paidAt)}
                                  {payment.note ? ` · ${payment.note}` : ''}
                                </p>
                              </div>
                              <span className="font-mono shrink-0">{moneyExact(payment.amount, currency)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={payTarget !== null}
        onClose={closePayment}
        title="Record credit payment"
        subtitle={payTarget ? `${payTarget.creditorName} · balance ${moneyExact(targetBalance, currency)}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closePayment}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayment()} loading={paying}>
              <CheckCircle2 className="w-4 h-4" /> Save payment
            </Button>
          </>
        }
      >
        {payTarget && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium">
                Amount ({currency})
                <input
                  type="number"
                  min={0}
                  max={targetBalance}
                  step="0.01"
                  value={payAmount}
                  onChange={(event) => setPayAmount(event.target.value)}
                  disabled={payIntent?.status === 'pending' || payIntent?.status === 'success'}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
                />
              </label>
              <label className="block text-xs font-medium">
                Method
                <select
                  value={payMethod}
                  onChange={(event) => setPayMethod(event.target.value as 'Cash' | 'Mpesa')}
                  disabled={payIntent?.status === 'pending' || payIntent?.status === 'success'}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="Mpesa" disabled={!mpesa.configured && !mpesa.manualEnabled}>
                    M-Pesa
                  </option>
                </select>
              </label>
            </div>
            <div className="flex gap-1.5">
              {[targetBalance, Math.min(1000, targetBalance), Math.min(500, targetBalance)].map((value, index) => (
                <button
                  key={`${value}-${index}`}
                  type="button"
                  onClick={() => setPayAmount(String(value))}
                  className="px-2.5 py-1 rounded-md bg-stone-100 dark:bg-zinc-800 text-[11px] font-mono hover:bg-stone-200 dark:hover:bg-zinc-700 cursor-pointer"
                >
                  {value.toLocaleString()}
                </button>
              ))}
            </div>

            {payMethod === 'Mpesa' && (
              <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-2.5 space-y-2">
                {mpesa.configured && mpesa.manualEnabled && (
                  <div className="inline-flex rounded-md border border-stone-200 dark:border-zinc-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPayMpesaMode('stk')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium cursor-pointer',
                        payMpesaMode === 'stk' ? 'bg-rose-900 text-white' : 'text-stone-600 dark:text-zinc-300',
                      )}
                    >
                      STK Push
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMpesaMode('manual')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium cursor-pointer',
                        payMpesaMode === 'manual' ? 'bg-rose-900 text-white' : 'text-stone-600 dark:text-zinc-300',
                      )}
                    >
                      SMS code
                    </button>
                  </div>
                )}
                {payMpesaMode === 'stk' && mpesa.configured ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                      Send an STK Push of {money(amountValue, currency)} to{' '}
                      {payTarget.creditorPhone || 'the customer'}.
                    </p>
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => void startPaymentStk()}
                      loading={stkBusy}
                      disabled={payIntent?.status === 'pending' || payIntent?.status === 'success'}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      {payIntent?.status === 'success' ? 'Payment confirmed' : 'Send STK Push'}
                    </Button>
                    {payIntent && (
                      <div
                        className={cn(
                          'rounded-md px-2.5 py-2 text-[11px]',
                          payIntent.status === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                            : payIntent.status === 'pending'
                              ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300'
                              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
                        )}
                      >
                        <p className="font-medium">
                          {payIntent.status === 'success'
                            ? `Confirmed${payIntent.receipt ? ` · ${payIntent.receipt}` : ''}`
                            : payIntent.status === 'pending'
                              ? 'Waiting for the customer…'
                              : `Payment ${payIntent.status}`}
                        </p>
                        {payIntent.message && <p className="opacity-80 mt-0.5">{payIntent.message}</p>}
                        {payIntent.status !== 'success' && payIntent.status !== 'pending' && (
                          <button
                            type="button"
                            onClick={() => setPayIntent(null)}
                            className="underline underline-offset-2 mt-1 cursor-pointer"
                          >
                            Try again
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : mpesa.manualEnabled ? (
                  <MpesaMessagePanel
                    expectedAmount={amountValue}
                    tillNumber={settings.mpesaTillNumber || '—'}
                    value={payManual?.raw ?? ''}
                    onChange={(raw, details, valid) => setPayManual({ raw, details, valid })}
                  />
                ) : (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    M-Pesa payments are not configured for this store.
                  </p>
                )}
              </div>
            )}

            <label className="block text-xs font-medium">
              Note
              <input
                type="text"
                value={payNote}
                onChange={(event) => setPayNote(event.target.value)}
                placeholder="Optional reference"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
              />
            </label>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              New balance after this payment:{' '}
              <span className="font-mono font-semibold">
                {money(Math.max(0, targetBalance - amountValue), currency)}
              </span>
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit credit account"
        subtitle={editTarget?.creditorName}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-credit-form" loading={editBusy}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-credit-form" onSubmit={(event) => void submitEdit(event)} className="space-y-3">
          <label className="block text-xs font-medium">
            Customer name
            <input
              type="text"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Phone
            <input
              type="tel"
              value={editPhone}
              onChange={(event) => setEditPhone(event.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Due date
            <input
              type="date"
              value={editDue}
              min={editTarget?.pendingDate}
              onChange={(event) => setEditDue(event.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </label>
          <label className="block text-xs font-medium">
            Notes
            <textarea
              rows={3}
              value={editNotes}
              onChange={(event) => setEditNotes(event.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </label>
        </form>
      </Modal>
    </div>
  );
};
