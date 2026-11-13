import { CreditRecord, CreditStatus, Product, SaleTransaction } from '../types';

export type DemandTier = 'High Demand' | 'Steady' | 'Slow Moving' | 'Near Expiry';

export interface DynamicPriceRecommendation {
  productId: string;
  unitsSold7d: number;
  unitsSoldToday: number;
  demandTier: DemandTier;
  suggestedPrice: number;
  deltaPercent: number;
  reason: string;
  needsAdjustment: boolean;
}

export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate + 'T00:00:00');
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function getExpiryStatus(product: Product): {
  label: string;
  level: 'none' | 'fresh' | 'soon' | 'expired';
  daysLeft: number | null;
} {
  if (!product.isPerishable || !product.expiryDate) {
    return { label: 'Non-perishable', level: 'none', daysLeft: null };
  }
  const days = daysUntilExpiry(product.expiryDate);
  if (days === null) return { label: 'No date', level: 'none', daysLeft: null };
  if (days < 0) return { label: `Expired (${Math.abs(days)}d ago)`, level: 'expired', daysLeft: days };
  if (days === 0) return { label: 'Expires today', level: 'expired', daysLeft: 0 };
  if (days <= 30) return { label: `Expires in ${days}d`, level: 'soon', daysLeft: days };
  return { label: `Valid (${days}d left)`, level: 'fresh', daysLeft: days };
}

export function computeDynamicRecommendation(
  product: Product,
  transactions: SaleTransaction[],
): DynamicPriceRecommendation {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const todayKey = new Date().toISOString().slice(0, 10);

  let unitsSold7d = 0;
  let unitsSoldToday = 0;

  for (const tx of transactions) {
    const txTime = new Date(tx.createdAt).getTime();
    const txDay = tx.createdAt.slice(0, 10);
    for (const item of tx.items) {
      if (item.productId === product.id) {
        if (txTime >= sevenDaysAgo) unitsSold7d += item.quantity;
        if (txDay === todayKey) unitsSoldToday += item.quantity;
      }
    }
  }

  const expiry = getExpiryStatus(product);
  const minFloor = Math.ceil(product.costPrice * 1.05);

  // Priority 1: Near-expiry perishable markdown to clear stock before spoilage
  if (expiry.level === 'soon' && expiry.daysLeft !== null && expiry.daysLeft <= 21 && product.stock > 0) {
    const discount = expiry.daysLeft <= 7 ? 0.2 : 0.12;
    const rawSuggested = Math.round((product.basePrice * (1 - discount)) / 5) * 5;
    const suggestedPrice = Math.max(minFloor, rawSuggested);
    const deltaPercent = Math.round(((suggestedPrice - product.currentPrice) / product.currentPrice) * 100);
    return {
      productId: product.id,
      unitsSold7d,
      unitsSoldToday,
      demandTier: 'Near Expiry',
      suggestedPrice,
      deltaPercent,
      reason: `Perishable expires in ${expiry.daysLeft} days — clearance markdown to protect margin`,
      needsAdjustment: Math.abs(suggestedPrice - product.currentPrice) >= 5,
    };
  }

  // Priority 2: High velocity + tightening stock -> demand surge pricing (+8% to +12%)
  if (unitsSold7d >= 6 || (unitsSold7d >= 3 && product.stock <= product.reorderLevel * 1.6)) {
    const surgeFactor = product.stock <= product.reorderLevel ? 1.12 : 1.08;
    const suggestedPrice = Math.round((product.basePrice * surgeFactor) / 5) * 5;
    const deltaPercent = Math.round(((suggestedPrice - product.currentPrice) / product.currentPrice) * 100);
    return {
      productId: product.id,
      unitsSold7d,
      unitsSoldToday,
      demandTier: 'High Demand',
      suggestedPrice,
      deltaPercent,
      reason: `${unitsSold7d} units sold in 7d with ${product.stock} left in stock`,
      needsAdjustment: Math.abs(suggestedPrice - product.currentPrice) >= 5,
    };
  }

  // Priority 3: Slow moving with high stock -> promotional markdown (-8%)
  if (unitsSold7d === 0 && product.stock >= product.reorderLevel * 2) {
    const rawSuggested = Math.round((product.basePrice * 0.92) / 5) * 5;
    const suggestedPrice = Math.max(minFloor, rawSuggested);
    const deltaPercent = Math.round(((suggestedPrice - product.currentPrice) / product.currentPrice) * 100);
    return {
      productId: product.id,
      unitsSold7d,
      unitsSoldToday,
      demandTier: 'Slow Moving',
      suggestedPrice,
      deltaPercent,
      reason: `0 units sold in 7d (${product.stock} in stock) — slight promo boost`,
      needsAdjustment: Math.abs(suggestedPrice - product.currentPrice) >= 5,
    };
  }

  // Balanced -> Return to base price
  const deltaPercent = Math.round(((product.basePrice - product.currentPrice) / product.currentPrice) * 100);
  return {
    productId: product.id,
    unitsSold7d,
    unitsSoldToday,
    demandTier: 'Steady',
    suggestedPrice: product.basePrice,
    deltaPercent,
    reason: `Steady demand (${unitsSold7d} sold in 7d) — optimal at base price`,
    needsAdjustment: Math.abs(product.basePrice - product.currentPrice) >= 5,
  };
}

export function computeCreditStatus(record: CreditRecord): CreditStatus {
  const balance = Math.max(0, record.totalAmount - record.amountPaid);
  if (balance <= 0.01) return 'Paid';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = record.dueDate ? new Date(record.dueDate + 'T00:00:00') : null;
  if (due && due.getTime() < today.getTime()) {
    return 'Overdue';
  }

  if (record.amountPaid > 0) return 'Partial';
  return 'Pending';
}
