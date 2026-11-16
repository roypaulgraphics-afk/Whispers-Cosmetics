import React, { useState } from 'react';
import { CheckCircle2, ImagePlus, Upload } from 'lucide-react';
import { PRODUCT_CATEGORIES, Product, ProductCategory, StoreSettings } from '../types';
import { PRESET_PRODUCT_IMAGES } from '../lib/defaultImages';
import { processUploadedImage } from '../lib/imageUpload';
import { ProductThumbnail } from './ProductThumbnail';

interface ProductFormViewProps {
  initialProduct?: Product | null;
  settings: StoreSettings;
  onSubmit: (data: Omit<Product, 'id' | 'updatedAt'>, options?: { addAnother?: boolean }) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

export const ProductFormView: React.FC<ProductFormViewProps> = ({
  initialProduct,
  settings,
  onSubmit,
  onCancel,
  submitLabel = 'Save Product Listing',
}) => {
  const [name, setName] = useState(initialProduct?.name ?? '');
  const [brand, setBrand] = useState(initialProduct?.brand ?? 'Whispers Botanicals');
  const [category, setCategory] = useState<ProductCategory>(
    initialProduct?.category ?? 'Lotion',
  );
  const [costPrice, setCostPrice] = useState(String(initialProduct?.costPrice ?? 450));
  const [basePrice, setBasePrice] = useState(String(initialProduct?.basePrice ?? 800));
  const [currentPrice, setCurrentPrice] = useState(
    String(initialProduct?.currentPrice ?? 800),
  );
  const [autoDynamicPricing, setAutoDynamicPricing] = useState(
    initialProduct?.autoDynamicPricing ?? true,
  );
  const [stock, setStock] = useState(String(initialProduct?.stock ?? 15));
  const [reorderLevel, setReorderLevel] = useState(String(initialProduct?.reorderLevel ?? 6));
  const [isPerishable, setIsPerishable] = useState(initialProduct?.isPerishable ?? true);
  const [expiryDate, setExpiryDate] = useState(
    initialProduct?.expiryDate ?? new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
  );
  const [imageUrl, setImageUrl] = useState(initialProduct?.imageUrl ?? 'preset:lotion');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await processUploadedImage(file, 520);
      setImageUrl(dataUrl);
      setError('');
    } catch {
      setError('Could not process that image file. Please try a PNG or JPG.');
    }
  };

  const resetForm = () => {
    setName('');
    setBrand('Whispers Botanicals');
    setCategory('Lotion');
    setCostPrice('450');
    setBasePrice('800');
    setCurrentPrice('800');
    setAutoDynamicPricing(true);
    setStock('15');
    setReorderLevel('6');
    setIsPerishable(true);
    setExpiryDate(new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));
    setImageUrl('preset:lotion');
  };

  const saveListing = async (addAnother = false) => {
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }
    setSaving(true);
    setError('');
    setSavedNotice('');
    try {
      const autoSku =
        initialProduct?.sku ||
        `WC-${category.slice(0, 3).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
      const autoBarcode =
        initialProduct?.barcode ||
        `616400${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 13);

      await onSubmit(
        {
          name: name.trim(),
          brand: brand.trim() || 'Whispers Cosmetics',
          sku: autoSku,
          barcode: autoBarcode,
          category,
          costPrice: Math.max(0, Number(costPrice || 0)),
          basePrice: Math.max(0, Number(basePrice || 0)),
          currentPrice: Math.max(0, Number(currentPrice || basePrice || 0)),
          autoDynamicPricing,
          stock: Math.max(0, Math.floor(Number(stock || 0))),
          reorderLevel: Math.max(0, Math.floor(Number(reorderLevel || 0))),
          isPerishable,
          expiryDate: isPerishable && expiryDate ? expiryDate : null,
          imageUrl: imageUrl.trim(),
        },
        { addAnother },
      );

      if (!initialProduct && addAnother) {
        const addedName = name.trim();
        resetForm();
        setSavedNotice(`"${addedName}" added to inventory. Ready for your next listing.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveListing(false);
  };

  const margin = Number(currentPrice || 0) - Number(costPrice || 0);
  const marginPct =
    Number(currentPrice) > 0 ? Math.round((margin / Number(currentPrice)) * 100) : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="px-4 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs font-medium text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {savedNotice && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Step 1: Product Image Upload & Studio Presets */}
        <div className="lg:col-span-4 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-rose-900 dark:text-rose-400" />
            <span>01. Product Photo</span>
          </h3>

          <div className="flex justify-center">
            <ProductThumbnail
              imageUrl={imageUrl}
              name={name || 'New Product'}
              category={category}
              className="w-44 h-44 rounded-xl"
            />
          </div>

          <label className="w-full py-2.5 px-4 rounded-xl border border-dashed border-stone-300 dark:border-zinc-700 hover:border-rose-700 dark:hover:border-rose-500 bg-stone-50 dark:bg-zinc-950 flex items-center justify-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            <span>Upload Photo from Device</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          <div>
            <p className="text-xs font-medium text-stone-500 dark:text-zinc-400 mb-2">
              Or Select Studio Cosmetic Preset
            </p>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(PRESET_PRODUCT_IMAGES).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setImageUrl(key)}
                  title={preset.label}
                  className={`rounded-lg overflow-hidden border-2 transition-all cursor-pointer aspect-square ${
                    imageUrl === key
                      ? 'border-rose-900 dark:border-rose-500 scale-105'
                      : 'border-transparent opacity-75 hover:opacity-100'
                  }`}
                >
                  <img src={preset.src} alt={preset.label} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1">
              Image URL (optional)
            </label>
            <input
              type="text"
              value={imageUrl.startsWith('data:') ? '' : imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Paste custom image URL or preset key"
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-stone-900 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Step 2-4: Product Details, Pricing, Stock & Perishables */}
        <div className="lg:col-span-8 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-3">
              02. Product Details &amp; Category
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Cocoa & Almond Silk Body Lotion 400ml"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ProductCategory)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                >
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Brand / Supplier
                </label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Pricing & Stock */}
          <div className="pt-4 border-t border-stone-100 dark:border-zinc-800 space-y-3">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              03. Pricing &amp; Stock Levels
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Cost ({settings.currency})
                </label>
                <input
                  type="number"
                  min={0}
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Base Price
                </label>
                <input
                  type="number"
                  min={0}
                  value={basePrice}
                  onChange={(e) => {
                    setBasePrice(e.target.value);
                    if (!initialProduct) setCurrentPrice(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Active Price
                </label>
                <input
                  type="number"
                  min={0}
                  value={currentPrice}
                  onChange={(e) => setCurrentPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num font-semibold text-rose-900 dark:text-rose-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Stock Qty
                </label>
                <input
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400 mb-1.5">
                  Reorder At
                </label>
                <input
                  type="number"
                  min={0}
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="text-xs font-mono-num text-stone-500 dark:text-zinc-400">
                Unit Margin: {settings.currency} {margin.toLocaleString()} ({marginPct}%)
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDynamicPricing}
                  onChange={(e) => setAutoDynamicPricing(e.target.checked)}
                  className="rounded border-stone-300 text-rose-900 focus:ring-rose-800"
                />
                <span>Enable demand-based dynamic price adjustments</span>
              </label>
            </div>
          </div>

          {/* Step 4: Perishability */}
          <div className="pt-4 border-t border-stone-100 dark:border-zinc-800 space-y-3">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              04. Perishable Shelf Life
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPerishable}
                  onChange={(e) => setIsPerishable(e.target.checked)}
                  className="rounded border-stone-300 text-rose-900 focus:ring-rose-800"
                />
                <span>Perishable item (track expiration date)</span>
              </label>

              {isPerishable && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-stone-500 dark:text-zinc-400">Expiry Date:</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono-num text-stone-900 dark:text-zinc-100"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-stone-100 dark:border-zinc-800 flex flex-wrap items-center justify-end gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            {!initialProduct && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveListing(true)}
                className="px-4 py-2.5 rounded-xl border border-stone-300 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800 text-stone-800 dark:text-zinc-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Save &amp; Add Another
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
