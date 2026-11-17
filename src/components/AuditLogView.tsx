import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText, Search } from 'lucide-react';
import type { AuditEntry } from '../types';
import { api, withQuery } from '../lib/api';
import { cn, dateTime, friendlyAction, timeOnly } from '../lib/format';
import { Badge, Button, EmptyState, SectionHeading, Spinner } from './ui';

interface AuditLogViewProps {
  showToast?: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'sale.create',
  'sale.refund',
  'credit.create',
  'credit.payment',
  'credit.update',
  'product.create',
  'product.update',
  'product.archive',
  'product.restore',
  'product.restock',
  'product.stock_adjust',
  'settings.update',
  'settings.pin_change',
  'backup.create',
  'backup.download',
  'image.upload',
];

function actionTone(action: string): 'green' | 'amber' | 'red' | 'blue' | 'neutral' {
  if (action.includes('failed') || action.includes('refund')) return 'red';
  if (action.startsWith('auth')) return 'amber';
  if (action.startsWith('sale')) return 'green';
  if (action.startsWith('credit')) return 'blue';
  return 'neutral';
}

function prettyDetails(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ showToast }) => {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [action, setAction] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [debounced, action, from, to]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await api<{ entries: AuditEntry[]; total: number }>(
          withQuery('/api/audit', {
            q: debounced || undefined,
            action: action === 'all' ? undefined : action,
            from: from || undefined,
            to: to || undefined,
            limit: PAGE_SIZE,
            offset,
          }),
        );
        if (cancelled) return;
        setEntries(result.entries);
        setTotal(result.total);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load the audit trail.');
          setEntries([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [debounced, action, from, to, offset, reloadKey]);

  const actionsInPage = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.action))),
    [entries],
  );
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Audit trail"
        description={`${total} event(s) recorded · newest first`}
        action={
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </Button>
        }
      />

      <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="p-3 border-b border-stone-100 dark:border-zinc-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, entity or details…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800/30"
            />
          </div>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none max-w-[180px]"
          >
            <option value="all">All actions</option>
            {(actionsInPage.length ? actionsInPage : ACTION_OPTIONS).map((entry) => (
              <option key={entry} value={entry}>
                {friendlyAction(entry)}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-zinc-400">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-zinc-400">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </label>
        </div>

        {error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Retry
            </Button>
          </div>
        ) : loading ? (
          <Spinner label="Loading audit entries…" className="py-16" />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="w-5 h-5" />}
            title="No audit entries match"
            description="Try a wider date range or a different action."
          />
        ) : (
          <>
            <ul className="divide-y divide-stone-100 dark:divide-zinc-800">
              {entries.map((entry) => {
                const key = String(entry.id);
                const isOpen = expanded === key;
                return (
                  <li key={key} className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      className="w-full text-left flex items-start justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={actionTone(entry.action)}>{friendlyAction(entry.action)}</Badge>
                          <span className="text-[11px] text-stone-500 dark:text-zinc-400">
                            {entry.entityType}
                            {entry.entityId ? ` · ${entry.entityId.slice(0, 18)}` : ''}
                          </span>
                        </div>
                        {!isOpen && entry.details && (
                          <p className="mt-1 text-[11px] text-stone-500 dark:text-zinc-400 truncate max-w-[520px] font-mono">
                            {entry.details}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-stone-600 dark:text-zinc-300">{dateTime(entry.createdAt)}</p>
                        <p className="text-[10px] text-stone-400">{timeOnly(entry.createdAt)}</p>
                      </div>
                    </button>
                    {isOpen && entry.details && (
                      <pre className="mt-2 rounded-lg bg-stone-950 text-stone-100 text-[11px] p-3 overflow-x-auto whitespace-pre-wrap break-words">
                        {prettyDetails(entry.details)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-2.5 border-t border-stone-100 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs">
              <span className="text-stone-500 dark:text-zinc-400">
                {total} event(s) · page {page} of {pages}
              </span>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Newer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Older <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
