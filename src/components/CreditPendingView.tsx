import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Plus,
  Smartphone,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CreditRecord,
  CreditStatus,
  MpesaDetails,
  Product,
  StoreSettings,
} from '../types';
import { computeCreditStatus } from '../lib/dynamicPricing';
import { MpesaMessagePanel } from './MpesaMessagePanel';

interface CreditPendingViewProps {
  credits: CreditRecord[];
  products: Product[];
  settings: StoreSettings;
  onCreateCredit: (payload: {
    creditorName: string;
    creditorPhone: string;
    pendingDate: string;
    dueDate: string;
    totalAmount: number;
    amountPaid: number;
    notes: string;
    items: CreditRecord['items'];
  }) => Promise<void>;
  onUpdateCredit: (
    id: string,
    payload: {
      creditorName: string;
      creditorPhone: string;
      pendingDate: string;
      dueDate: string;
      notes: string;
    },
  ) => Promise<void>;
  onRecordPayment: (
    id: string,
    payload: {
      amount: number;
      method: 'Cash' | 'Mpesa';
      mpesaDetails?: MpesaDetails;
      note?: string;
    },
  ) => Promise<void>;
}

export const CreditPendingView: React.FC<CreditPendingViewProps> = ({
  credits,
  products,
  settings,
  onCreateCredit,
  onUpdateCredit,
  onRecordPayment,
}) => {
  const [statusFilter, setStatusFilter] = useState<CreditStatus | 'All'>('All');
  const [editingRecord, setEditingRecord] = useState<CreditRecord | null>(null);
  const [payingRecord, setPayingRecord] = useState<CreditRecord | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  // Edit Creditor Form State
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPendingDate, setEditPendingDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Payment Settlement State
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'Cash' | 'Mpesa'>('Cash');
  const [payNote, setPayNote] = useState('');
  const [mpesaRaw, setMpesaRaw] = useState('');
  const [mpesaParsed, setMpesaParsed] = useState<MpesaDetails | undefined>(undefined);

  // New Standalone Credit State
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPendingDate, setNewPendingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDueDate, setNewDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [newProductId, setNewProductId] = useState(products[0]?.id ?? '');
  const [newQty, setNewQty] = useState('1');
  const [newCustomTotal, setNewCustomTotal] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const enriched = useMemo(() => {
    return credits.map((c) => ({
      record: c,
      status: computeCreditStatus(c),
      balance: Math.max(0, c.totalAmount - c.amountPaid),
    }));
  }, [credits]);

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return enriched;
    return enriched.filter((e) => e.status === statusFilter);
  }, [enriched, statusFilter]);

  const totalOutstanding = enriched.reduce((sum, e) => sum + e.balance, 0);
  const overdueCount = enriched.filter((e) => e.status === 'Overdue').length;
  const pendingCount = enriched.filter((e) => e.status !== 'Paid').length;
  const settledAmount = enriched.reduce((sum, e) => sum + e.record.amountPaid, 0);

  const openEditModal = (c: CreditRecord) => {
    setEditingRecord(c);
    setEditName(c.creditorName);
    setEditPhone(c.creditorPhone);
    setEditPendingDate(c.pendingDate);
    setEditDueDate(c.dueDate);
    setEditNotes(c.notes);
  };

  const openPayModal = (c: CreditRecord) => {
    const bal = Math.max(0, c.totalAmount - c.amountPaid);
    setPayingRecord(c);
    setPayAmount(String(bal));
    setPayMethod('Cash');
    setPayNote('');
    setMpesaRaw('');
    setMpesaParsed(undefined);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord || !editName.trim()) return;
    await onUpdateCredit(editingRecord.id, {
      creditorName: editName.trim(),
      creditorPhone: editPhone.trim(),
      pendingDate: editPendingDate,
      dueDate: editDueDate,
      notes: editNotes.trim(),
    });
    setEditingRecord(null);
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingRecord) return;
    const amt = Number(payAmount || 0);
    if (amt <= 0) return;
    if (payMethod === 'Mpesa' && !mpesaRaw.trim()) return;
    await onRecordPayment(payingRecord.id, {
      amount: amt,
      method: payMethod,
      mpesaDetails: payMethod === 'Mpesa' ? mpesaParsed : undefined,
      note: payNote.trim(),
    });
    setPayingRecord(null);
  };

  const handleCreateCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const prod = products.find((p) => p.id === newProductId);
    const qty = Math.max(1, Number(newQty || 1));
    const computedTotal =
      Number(newCustomTotal) > 0
        ? Number(newCustomTotal)
        : prod
          ? prod.currentPrice * qty
          : 0;

    await onCreateCredit({
      creditorName: newName.trim(),
      creditorPhone: newPhone.trim(),
      pendingDate: newPendingDate,
      dueDate: newDueDate,
      totalAmount: computedTotal,
      amountPaid: 0,
      notes: newNotes.trim(),
      items: prod
        ? [
            {
              productId: prod.id,
              productName: prod.name,
              category: prod.category,
              quantity: qty,
              unitPrice: prod.currentPrice,
              costPrice: prod.costPrice,
            },
          ]
        : [],
    });

    setShowNewModal(false);
    setNewName('');
    setNewPhone('');
    setNewCustomTotal('');
    setNewNotes('');
  };

  const renderStatusLabel = (status: CreditStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Paid in Full</span>
          </span>
        );
      case 'Overdue':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Overdue</span>
          </span>
        );
      case 'Partial':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Partial Payment</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-700 dark:text-zinc-300">
            <Clock className="w-3.5 h-3.5" />
            <span>Pending</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">
            Outstanding Credit Balance
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {settings.currency} {totalOutstanding.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Active Accounts</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-stone-900 dark:text-zinc-50">
            {pendingCount} creditors
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Overdue Accounts</p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono-num ${
              overdueCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {overdueCount} overdue
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">Collected So Far</p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-emerald-700 dark:text-emerald-400">
            {settings.currency} {settledAmount.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Filter & Add Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['All', 'Pending', 'Partial', 'Overdue', 'Paid'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === status
                  ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add Credit / Pending Entry</span>
        </button>
      </div>

      {/* Credit & Pending List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-14 text-center">
            <UserCheck className="w-8 h-8 text-stone-300 dark:text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-stone-700 dark:text-zinc-300">
              No credit or pending accounts in this filter
            </p>
          </div>
        ) : (
          filtered.map(({ record, status, balance }) => (
            <div
              key={record.id}
              className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      {record.creditorName}
                    </h3>
                    {renderStatusLabel(status)}
                  </div>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {record.creditorPhone && (
                      <span className="font-mono-num">{record.creditorPhone}</span>
                    )}
                    <span className="inline-flex items-center gap-1 font-mono-num">
                      <Calendar className="w-3.5 h-3.5" />
                      Pending Day: {record.pendingDate}
                    </span>
                    <span className="font-mono-num">Due: {record.dueDate}</span>
                  </p>
                  {record.notes && (
                    <p className="text-xs text-stone-600 dark:text-zinc-400 pt-1">{record.notes}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(record)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Creditor &amp; Date</span>
                  </button>
                  {balance > 0 && (
                    <button
                      type="button"
                      onClick={() => openPayModal(record)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>Record Payment</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Financial & Products Summary */}
              <div className="pt-3 border-t border-stone-100 dark:border-zinc-800 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-7 text-xs text-stone-600 dark:text-zinc-400">
                  <span className="font-medium text-stone-800 dark:text-zinc-200">
                    Pending Products:{' '}
                  </span>
                  {record.items.length > 0
                    ? record.items.map((i) => `${i.quantity}× ${i.productName}`).join(' · ')
                    : 'Manual credit balance'}
                </div>

                <div className="md:col-span-5 flex items-center md:justify-end gap-5 text-xs font-mono-num">
                  <div>
                    <span className="text-stone-400 dark:text-zinc-500 block text-[11px]">Total</span>
                    <span className="font-medium text-stone-800 dark:text-zinc-200">
                      {settings.currency} {record.totalAmount.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 dark:text-zinc-500 block text-[11px]">Paid</span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {settings.currency} {record.amountPaid.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 dark:text-zinc-500 block text-[11px]">Balance</span>
                    <span className="font-semibold text-stone-900 dark:text-zinc-50">
                      {settings.currency} {balance.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Real-time Payment History */}
              {record.payments.length > 0 && (
                <div className="pt-3 border-t border-stone-100 dark:border-zinc-800 space-y-1.5">
                  <p className="text-[11px] font-medium text-stone-500 dark:text-zinc-400">
                    Real-Time Payment History
                  </p>
                  {record.payments.map((pmt) => (
                    <div
                      key={pmt.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600 dark:text-zinc-300"
                    >
                      <span>
                        {pmt.method}
                        {pmt.mpesaDetails?.transactionCode
                          ? ` (${pmt.mpesaDetails.transactionCode})`
                          : ''}
                        {pmt.note ? ` · ${pmt.note}` : ''}
                      </span>
                      <span className="font-mono-num">
                        +{settings.currency} {pmt.amount.toLocaleString()} ·{' '}
                        {new Date(pmt.paidAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Edit Creditor Name & Pending Date Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Edit Creditor &amp; Pending Day
              </h2>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Creditor Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Pending Day Date
                  </label>
                  <input
                    type="date"
                    required
                    value={editPendingDate}
                    onChange={(e) => setEditPendingDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                Update Creditor
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Payment Modal */}
      {payingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4 overflow-y-auto">
          <form
            onSubmit={handleConfirmPayment}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 space-y-4 shadow-xl my-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Settle Payment · {payingRecord.creditorName}
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400 font-mono-num">
                  Remaining Balance: {settings.currency}{' '}
                  {Math.max(0, payingRecord.totalAmount - payingRecord.amountPaid).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayingRecord(null)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Amount ({settings.currency})
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={Math.max(1, payingRecord.totalAmount - payingRecord.amountPaid)}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('Cash')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                      payMethod === 'Cash'
                        ? 'bg-rose-900 border-rose-900 text-white dark:bg-rose-700'
                        : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                    }`}
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    <span>Cash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('Mpesa')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                      payMethod === 'Mpesa'
                        ? 'bg-rose-900 border-rose-900 text-white dark:bg-rose-700'
                        : 'border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>M-Pesa</span>
                  </button>
                </div>
              </div>
            </div>

            {payMethod === 'Mpesa' && (
              <MpesaMessagePanel
                expectedAmount={Number(payAmount || 0)}
                tillNumber={settings.mpesaTillNumber}
                value={mpesaRaw}
                onChange={(raw, parsed) => {
                  setMpesaRaw(raw);
                  setMpesaParsed(parsed);
                }}
              />
            )}

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                Payment Note (optional)
              </label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Second installment"
                className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingRecord(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={payMethod === 'Mpesa' && !mpesaRaw.trim()}
                className="px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
              >
                Save Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Standalone Credit / Pending Entry Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
          <form
            onSubmit={handleCreateCredit}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                New Credit / Pending Entry
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Creditor Name *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Customer or salon name"
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="0712..."
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Pending Day Date
                  </label>
                  <input
                    type="date"
                    value={newPendingDate}
                    onChange={(e) => setNewPendingDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Product
                  </label>
                  <select
                    value={newProductId}
                    onChange={(e) => setNewProductId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({settings.currency} {p.currentPrice})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                    Qty
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Override Total ({settings.currency}, optional)
                </label>
                <input
                  type="number"
                  min={0}
                  value={newCustomTotal}
                  onChange={(e) => setNewCustomTotal(e.target.value)}
                  placeholder="Leave blank to calculate from product"
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Optional agreement notes"
                  className="w-full px-3.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                Save Credit Entry
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
