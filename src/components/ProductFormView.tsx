import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Save, Trash2, X } from 'lucide-react';
import type { Product, ProductCategory, StoreSettings } from '../types';
import { PRODUCT_CATEGORIES } from '../types';
import { api } from '../lib/api';
import { cn, money } from '../lib/format';
import { processUploadedImage } from '../lib/imageUpload';
import { PRESET_PRODUCT_IMAGES } from '../lib/defaultImages';
import { Button, SectionHeading } from './ui';
import { ProductThumbnail } from './ProductThumbnail';

interface ProductFormViewProps {
  product: Product | null;
  settings: StoreSettings;
  onSaved: (another: boolean) => Promise<void> | void;
  onCancel: () => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface FormState {
  name: string;
  brand: string;
  category: ProductCategory;
  sku: string;
  barcode: string;
  costPrice: string;
  basePrice: string;
  currentPrice: string;
  autoDynamicPricing: boolean;
  stock: string;
  reorderLevel: string;
  isPerishable: boolean;
  expiryDate: string;
  imageUrl: string;
}

function initialState(product: Product | null): FormState {
  return {
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    category: product?.category ?? 'Lotion',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    costPrice: product ? String(product.costPrice) : '',
    basePrice: product ? String(product.basePrice) : '',
    currentPrice: product ? String(product.currentPrice) : '',
    autoDynamicPricing: product?.autoDynamicPricing ?? true,
    stock: product ? String(product.stock) : '0',
    reorderLevel: product ? String(product.reorderLevel) : '5',
    isPerishable: product?.isPerishable ?? false,
    expiryDate: product?.expiryDate ?? '',
    imageUrl: product?.imageUrl ?? '',
  };
}

export const ProductFormView: React.FC<ProductFormViewProps> = ({
  product,
  settings,
  onSaved,
  onCancel,
  showToast,
}) => {
  const currency = settings.currency;
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isEdit = Boolean(product);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const copy = { ...current };
      delete copy[key as string];
      return copy;
    });
  };

  const margin = useMemo(() => {
    const cost = Number.parseFloat(form.costPrice) || 0;
    const price = Number.parseFloat(form.currentPrice) || Number.parseFloat(form.basePrice) || 0;
    if (price <= 0) return null;
    return ((price - cost) / price) * 100;
  }, [form.costPrice, form.currentPrice, form.basePrice]);

  const effectivePrice = useMemo(
    () => Number.parseFloat(form.currentPrice) || Number.parseFloat(form.basePrice) || 0,
    [form.currentPrice, form.basePrice],
  );

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      showToast('Choose a PNG, JPEG or WEBP image.', 'error');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await processUploadedImage(file);
      const result = await api<{ url: string }>('/api/uploads', {
        method: 'POST',
        body: { dataUrl, kind: 'product' },
      });
      update('imageUrl', result.url);
      showToast('Photo uploaded.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Image upload failed.', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter the product name.';
    const cost = Number.parseFloat(form.costPrice);
    const base = Number.parseFloat(form.basePrice);
    const current = form.currentPrice.trim() ? Number.parseFloat(form.currentPrice) : base;
    if (!Number.isFinite(cost) || cost < 0) next.costPrice = 'Enter a valid cost price.';
    if (!Number.isFinite(base) || base <= 0) next.basePrice = 'Base price must be greater than zero.';
    if (!Number.isFinite(current) || current <= 0) next.currentPrice = 'Selling price must be greater than zero.';
    if (form.sku.trim() && !/^[A-Za-z0-9._-]{2,40}$/.test(form.sku.trim())) {
      next.sku = 'Use letters, numbers, dots, dashes or underscores.';
    }
    if (form.barcode.trim() && !/^\d{6,14}$/.test(form.barcode.trim())) {
      next.barcode = 'Barcode must be 6 to 14 digits.';
    }
    const reorder = Number.parseInt(form.reorderLevel, 10);
    if (!Number.isFinite(reorder) || reorder < 0) next.reorderLevel = 'Enter a reorder level.';
    if (!isEdit) {
      const stock = Number.parseInt(form.stock, 10);
      if (!Number.isFinite(stock) || stock < 0) next.stock = 'Enter the opening stock.';
    }
    if (form.isPerishable && form.expiryDate && Number.isNaN(Date.parse(`${form.expiryDate}T00:00:00Z`))) {
      next.expiryDate = 'Choose a valid expiry date.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (another: boolean) => {
    if (!validate()) {
      showToast('Check the highlighted fields.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        category: form.category,
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        costPrice: Number.parseFloat(form.costPrice) || 0,
        basePrice: Number.parseFloat(form.basePrice),
        currentPrice: form.currentPrice.trim() ? Number.parseFloat(form.currentPrice) : Number.parseFloat(form.basePrice),
        autoDynamicPricing: form.autoDynamicPricing,
        reorderLevel: Number.parseInt(form.reorderLevel, 10) || 0,
        isPerishable: form.isPerishable,
        expiryDate: form.isPerishable ? form.expiryDate || null : null,
        imageUrl: form.imageUrl,
      };
      if (!isEdit) body.stock = Number.parseInt(form.stock, 10) || 0;

      if (isEdit && product) {
        await api(`/api/products/${product.id}`, { method: 'PATCH', body });
        showToast(`${form.name.trim()} updated.`);
        await onSaved(false);
      } else {
        await api('/api/products', { method: 'POST', body });
        showToast(`${form.name.trim()} added to inventory.`);
        await onSaved(another);
        if (another) setForm(initialState(null));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the product.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = (key: keyof FormState) =>
    cn(
      'mt-1 w-full px-3 py-2 rounded-lg border bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2',
      errors[key as string]
        ? 'border-red-400 focus:ring-red-500/30'
        : 'border-stone-200 dark:border-zinc-700 focus:ring-rose-800/30',
    );

  return (
    <div className="max-w-4xl space-y-5">
      <SectionHeading
        title={isEdit ? 'Edit product' : 'Add product'}
        description={
          isEdit
            ? 'Update pricing, barcode and packaging details. Use Inventory to change stock.'
            : 'Create a new product for the register.'
        }
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button onClick={() => void submit(false)} loading={saving}>
              <Save className="w-4 h-4" /> {isEdit ? 'Save changes' : 'Save product'}
            </Button>
          </div>
        }
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
        className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-5"
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <p className="text-xs font-medium mb-2">Product photo</p>
            {form.imageUrl ? (
              <div className="relative">
                <ProductThumbnail
                  imageUrl={form.imageUrl}
                  name={form.name || 'New product'}
                  className="w-full h-40 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => update('imageUrl', '')}
                  className="absolute -top-2 -right-2 p-1.5 rounded-full bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-red-600 shadow-sm cursor-pointer"
                  aria-label="Remove photo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full h-40 rounded-lg border border-dashed border-stone-300 dark:border-zinc-700 flex flex-col items-center justify-center gap-2 text-stone-500 dark:text-zinc-400 hover:border-rose-400 hover:text-rose-800 dark:hover:text-rose-300 cursor-pointer"
              >
                {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-medium">{uploading ? 'Uploading…' : 'Upload photo'}</span>
                <span className="text-[10px]">PNG, JPEG or WEBP · max 3 MB</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void handleImageFile(event.target.files?.[0])}
              className="hidden"
            />
            {form.imageUrl && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="mt-2 w-full text-xs font-medium text-rose-900 dark:text-rose-400 py-1 cursor-pointer disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Replace photo'}
              </button>
            )}
          </div>

          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
            <p className="text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-2">Or pick a preset</p>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(PRESET_PRODUCT_IMAGES).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update('imageUrl', key)}
                  title={preset.label}
                  className={cn(
                    'rounded-md overflow-hidden border-2 cursor-pointer',
                    form.imageUrl === key ? 'border-rose-800' : 'border-transparent hover:border-stone-300',
                  )}
                >
                  <img src={preset.src} alt={preset.label} className="w-full h-12 object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold">Details</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-xs font-medium sm:col-span-2">
                Product name *
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="e.g. Shea Body Lotion 400ml"
                  className={inputClass('name')}
                />
                {errors.name && <span className="text-[11px] text-red-600">{errors.name}</span>}
              </label>
              <label className="block text-xs font-medium">
                Brand
                <input
                  type="text"
                  value={form.brand}
                  onChange={(event) => update('brand', event.target.value)}
                  placeholder="e.g. Whispers"
                  className={inputClass('brand')}
                />
              </label>
              <label className="block text-xs font-medium">
                Category
                <select
                  value={form.category}
                  onChange={(event) => update('category', event.target.value as ProductCategory)}
                  className={inputClass('category')}
                >
                  {PRODUCT_CATEGORIES.map((entry) => (
                    <option key={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium">
                SKU
                <input
                  type="text"
                  value={form.sku}
                  onChange={(event) => update('sku', event.target.value)}
                  placeholder="Auto-generated if blank"
                  className={inputClass('sku')}
                />
                {errors.sku && <span className="text-[11px] text-red-600">{errors.sku}</span>}
              </label>
              <label className="block text-xs font-medium">
                Barcode
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.barcode}
                  onChange={(event) => update('barcode', event.target.value)}
                  placeholder="Auto-generated if blank"
                  className={cn(inputClass('barcode'), 'font-mono')}
                />
                {errors.barcode && <span className="text-[11px] text-red-600">{errors.barcode}</span>}
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pricing</h3>
              {margin !== null && (
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    margin < 10 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
                  )}
                >
                  Margin {margin.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs font-medium">
                Cost ({currency})
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.costPrice}
                  onChange={(event) => update('costPrice', event.target.value)}
                  className={cn(inputClass('costPrice'), 'font-mono')}
                />
                {errors.costPrice && <span className="text-[11px] text-red-600">{errors.costPrice}</span>}
              </label>
              <label className="block text-xs font-medium">
                Base price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.basePrice}
                  onChange={(event) => update('basePrice', event.target.value)}
                  className={cn(inputClass('basePrice'), 'font-mono')}
                />
                {errors.basePrice && <span className="text-[11px] text-red-600">{errors.basePrice}</span>}
              </label>
              <label className="block text-xs font-medium">
                Selling price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.currentPrice}
                  onChange={(event) => update('currentPrice', event.target.value)}
                  placeholder={form.basePrice || '0'}
                  className={cn(inputClass('currentPrice'), 'font-mono')}
                />
                {errors.currentPrice && <span className="text-[11px] text-red-600">{errors.currentPrice}</span>}
              </label>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              The register charges the selling price ({money(effectivePrice, currency)}). Base price is the reference used
              by dynamic pricing.
            </p>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.autoDynamicPricing}
                onChange={(event) => update('autoDynamicPricing', event.target.checked)}
                className="accent-rose-900 mt-0.5"
              />
              <span>
                Include in dynamic price recommendations
                <span className="block text-[11px] text-stone-500 dark:text-zinc-400">
                  Suggests markups for fast movers and markdowns for slow or expiring stock.
                </span>
              </span>
            </label>
          </section>

          <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold">Stock</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {isEdit ? (
                <div className="text-xs font-medium">
                  Current stock
                  <div className="mt-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 font-mono">
                    {product?.stock} units
                  </div>
                </div>
              ) : (
                <label className="block text-xs font-medium">
                  Opening stock
                  <input
                    type="number"
                    min={0}
                    value={form.stock}
                    onChange={(event) => update('stock', event.target.value)}
                    className={cn(inputClass('stock'), 'font-mono')}
                  />
                  {errors.stock && <span className="text-[11px] text-red-600">{errors.stock}</span>}
                </label>
              )}
              <label className="block text-xs font-medium">
                Reorder level
                <input
                  type="number"
                  min={0}
                  value={form.reorderLevel}
                  onChange={(event) => update('reorderLevel', event.target.value)}
                  className={cn(inputClass('reorderLevel'), 'font-mono')}
                />
                {errors.reorderLevel && <span className="text-[11px] text-red-600">{errors.reorderLevel}</span>}
              </label>
              <label className="inline-flex items-start gap-2 text-xs cursor-pointer select-none mt-5">
                <input
                  type="checkbox"
                  checked={form.isPerishable}
                  onChange={(event) => {
                    update('isPerishable', event.target.checked);
                    if (!event.target.checked) update('expiryDate', '');
                  }}
                  className="accent-rose-900 mt-0.5"
                />
                <span>Perishable product</span>
              </label>
            </div>
            {form.isPerishable && (
              <label className="block text-xs font-medium max-w-[220px]">
                Expiry date
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(event) => update('expiryDate', event.target.value)}
                  className={inputClass('expiryDate')}
                />
                {errors.expiryDate && <span className="text-[11px] text-red-600">{errors.expiryDate}</span>}
              </label>
            )}
            {isEdit && (
              <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                Use Inventory → Restock or physical count to change stock levels; all changes are logged.
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            {!isEdit && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => void submit(true)}
                disabled={saving}
              >
                Save &amp; add another
              </Button>
            )}
            <Button type="submit" loading={saving}>
              <Save className="w-4 h-4" /> {isEdit ? 'Save changes' : 'Save product'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};
