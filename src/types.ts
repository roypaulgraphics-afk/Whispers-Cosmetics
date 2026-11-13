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
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  category: ProductCategory;
  quantity: number;
  unitPrice: number;
  costPrice: number;
}

export type PaymentMode = 'Cash' | 'Mpesa' | 'Credit';

export interface MpesaDetails {
  transactionCode: string;
  senderName: string;
  senderPhone: string;
  amountReceived: number;
  rawMessage: string;
  verified: boolean;
  timestamp: string;
}

export interface SaleTransaction {
  id: string;
  receiptNo: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMode: PaymentMode;
  mpesaDetails?: MpesaDetails;
  creditRecordId?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface StoreSettings {
  storeName: string;
  logoUrl: string;
  pin: string;
  currency: string;
  mpesaTillNumber: string;
  autoDynamicEnabled: boolean;
  theme: 'light' | 'dark';
}

export interface AppDatabase {
  products: Product[];
  transactions: SaleTransaction[];
  credits: CreditRecord[];
  settings: StoreSettings;
}
