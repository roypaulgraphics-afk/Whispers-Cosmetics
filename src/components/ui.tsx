import React, { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '../lib/format';

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}> = ({ open, onClose, title, subtitle, children, footer, size = 'md' }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-[2px] cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col',
          widths[size],
        )}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 border-b border-stone-100 dark:border-zinc-800">
            <div>
              {title && (
                <h2 className="font-display text-xl font-semibold text-stone-900 dark:text-zinc-50">{title}</h2>
              )}
              {subtitle && (
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-stone-100 dark:border-zinc-800 flex flex-wrap items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'rose' | 'violet';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700 dark:bg-zinc-800 dark:text-zinc-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  blue: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  rose: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
};

export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  children,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
      BADGE_TONES[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const Spinner: React.FC<{ label?: string; className?: string }> = ({ label, className }) => (
  <div className={cn('flex items-center justify-center gap-2 text-sm text-stone-500 dark:text-zinc-400', className)}>
    <Loader2 className="w-4 h-4 animate-spin" />
    {label && <span>{label}</span>}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-6">
    {icon && (
      <div className="w-12 h-12 rounded-full bg-stone-100 dark:bg-zinc-800 text-stone-400 dark:text-zinc-500 flex items-center justify-center mb-3">
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-stone-800 dark:text-zinc-100">{title}</h3>
    {description && <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: 'rose' | 'emerald' | 'amber' | 'sky' | 'violet';
}> = ({ label, value, sub, icon, accent = 'rose' }) => {
  const accents = {
    rose: 'from-rose-900/90 to-rose-800 text-rose-50',
    emerald: 'from-emerald-800 to-emerald-700 text-emerald-50',
    amber: 'from-amber-700 to-amber-600 text-amber-50',
    sky: 'from-sky-800 to-sky-700 text-sky-50',
    violet: 'from-violet-800 to-violet-700 text-violet-50',
  } as const;
  return (
    <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-500 dark:text-zinc-400">{label}</span>
        {icon && (
          <span className={cn('w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0', accents[accent])}>
            {icon}
          </span>
        )}
      </div>
      <div>
        <p className="font-mono-num text-xl font-semibold text-stone-900 dark:text-zinc-50 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
};

export const SectionHeading: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
    <div>
      <h2 className="font-display text-2xl font-semibold text-stone-900 dark:text-zinc-50">{title}</h2>
      {description && <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">{description}</p>}
    </div>
    {action}
  </div>
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
    size?: 'sm' | 'md';
    loading?: boolean;
  }
> = ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }) => {
  const variants = {
    primary:
      'bg-rose-900 hover:bg-rose-950 text-white border border-rose-900 hover:border-rose-950 shadow-sm',
    secondary:
      'bg-white dark:bg-zinc-900 hover:bg-stone-50 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-100 border border-stone-200 dark:border-zinc-700',
    ghost:
      'bg-transparent hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-300 border border-transparent',
    danger: 'bg-red-600 hover:bg-red-700 text-white border border-red-600',
    success: 'bg-emerald-700 hover:bg-emerald-800 text-white border border-emerald-700',
  } as const;
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs rounded-lg',
    md: 'px-3.5 py-2 text-sm rounded-lg',
  } as const;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
};
