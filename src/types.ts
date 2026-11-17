export const PRODUCT_CATEGORIES = [
  'Lotion',
  'Braids',
  'Hair Oil',
  'Hair Spray',
  'Body Spray',
  'Baby Products',
  'Beauty Cream',
  'Beauty Soaps',
  'Hair Products - Chemical',
  'Hair Products - Hair Food',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface Product {
  id: string;
  name: string;
  brand: string;
  sku: string;
  barcode: string;
  category: ProductCategory;
  costPrice: number;
  basePrice: number;
  currentPrice: number;
  autoDynamicPricing: boolean;
  stock: number;
  reorderLevel: number;
  isPerishable: boolean;
  expiryDate: string | null;
  imageUrl: string;
  archived: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface SaleItem {
  id?: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  refundedQuantity?: number;
}

export type PaymentMode = 'Cash' | 'Mpesa' | 'Credit';
export type SaleStatus = 'Completed' | 'Partially Refunded' | 'Refunded';

export interface MpesaDetails {
  transactionCode: string;
  senderName: string;
  senderPhone: string;
  amountReceived: number;
  rawMessage: string;
  verified: boolean;
  timestamp: string;
  mode?: 'stk' | 'manual';
  intentId?: string;
}

export interface RefundItem {
  id?: string;
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  restock: boolean;
}

export interface RefundRecord {
  id: string;
  refundNo: string;
  saleId: string;
  saleReceiptNo: string;
  items: RefundItem[];
  totalAmount: number;
  method: 'Cash' | 'Mpesa';
  reason: string;
  restocked: boolean;
  cashier?: string;
  note?: string;
  businessDate: string;
  createdAt: string;
}

export interface SaleTransaction {
  id: string;
  receiptNo: string;
  items: SaleItem[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMode: PaymentMode;
  mpesaDetails?: MpesaDetails;
  creditRecordId?: string;
  cashTendered?: number;
  changeGiven?: number;
  status: SaleStatus;
  businessDate: string;
  cashier: string;
  note?: string;
  refunds?: RefundRecord[];
  createdAt: string;
}

export interface CreditPayment {
  id: string;
  amount: number;
  method: 'Cash' | 'Mpesa';
  mpesaDetails?: MpesaDetails;
  paidAt: string;
  note?: string;
}

export type CreditStatus = 'Pending' | 'Partial' | 'Overdue' | 'Paid';

export interface CreditRecord {
  id: string;
  creditorName: string;
  creditorPhone: string;
  pendingDate: string;
  dueDate: string;
  items: SaleItem[];
  totalAmount: number;
  amountPaid: number;
  notes: string;
  payments: CreditPayment[];
  saleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreSettings {
  storeName: string;
  logoUrl: string;
  currency: string;
  mpesaTillNumber: string;
  autoDynamicEnabled: boolean;
  theme: 'light' | 'dark';
  receiptFooter: string;
  pinIsDefault: boolean;
}

export type StockMovementReason =
  | 'opening'
  | 'sale'
  | 'refund'
  | 'restock'
  | 'adjustment'
  | 'credit';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  delta: number;
  reason: StockMovementReason;
  referenceId?: string;
  note?: string;
  businessDate: string;
  createdAt: string;
}

export interface MpesaInfo {
  configured: boolean;
  environment: 'sandbox' | 'production';
  shortcode?: string;
  reason?: string;
  manualEnabled: boolean;
}

export interface AppMeta {
  today: string;
  serverTime: string;
  timezone: string;
  version: string;
  appName: string;
}

export interface AppDatabase {
  products: Product[];
  transactions: SaleTransaction[];
  credits: CreditRecord[];
  refunds: RefundRecord[];
  settings: StoreSettings;
  meta: AppMeta;
  mpesa: MpesaInfo;
}

export interface SessionInfo {
  authenticated: boolean;
  store: {
    storeName: string;
    logoUrl: string;
    currency: string;
    theme: 'light' | 'dark';
  };
  pinIsDefault?: boolean;
}

export interface MpesaIntentStatus {
  id: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'error';
  resultCode?: string;
  resultDesc?: string;
  mpesaReceipt?: string;
  amount: number;
  phone: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface SalesTotals {
  salesCount: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  averageSale: number;
  cashSales: number;
  mpesaSales: number;
  creditSales: number;
}

export interface DailySalesPoint {
  date: string;
  sales: number;
  refunds: number;
  transactions: number;
}

export interface PaymentMixEntry {
  mode: PaymentMode;
  amount: number;
  count: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface OverviewReport {
  today: SalesTotals;
  yesterday: SalesTotals;
  last7: SalesTotals;
  last30: SalesTotals;
  paymentMix: PaymentMixEntry[];
  daily: DailySalesPoint[];
  topProducts: TopProductRow[];
  lowStock: Product[];
  expiring: Product[];
  outstandingCredit: number;
  activeCredits: number;
  customersOwing: number;
  totalProducts: number;
  inventoryValue: number;
  recentSales: SaleTransaction[];
}

export interface ReportData {
  from: string;
  to: string;
  totals: SalesTotals;
  previous: SalesTotals;
  previousFrom: string;
  previousTo: string;
  daily: DailySalesPoint[];
  paymentMix: PaymentMixEntry[];
  topProducts: TopProductRow[];
  refunds: RefundRecord[];
  creditCollected: number;
  overdueCredit: number;
}

export interface BootstrapData {
  products: Product[];
  credits: CreditRecord[];
  settings: StoreSettings;
  meta: AppMeta;
  mpesa: MpesaInfo;
  overview: OverviewReport;
}

