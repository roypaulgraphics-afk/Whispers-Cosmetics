import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AppDatabase,
  CreditPayment,
  CreditRecord,
  Product,
  SaleTransaction,
  StoreSettings,
} from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'whispers_db.json');

function isoDaysOffset(daysOffset: number, hour = 11, minute = 20): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateDaysOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function createSeedDatabase(): AppDatabase {
  const products: Product[] = [
    {
      id: 'prod-01',
      name: 'Whipped Shea & Rosehip Body Lotion 400ml',
      brand: 'Whispers Botanicals',
      sku: 'WC-LOT-101',
      barcode: '6164001001014',
      category: 'Lotion',
      costPrice: 520,
      basePrice: 850,
      currentPrice: 850,
      autoDynamicPricing: true,
      stock: 7,
      reorderLevel: 8,
      isPerishable: true,
      expiryDate: dateDaysOffset(145),
      imageUrl: 'preset:lotion',
      updatedAt: isoDaysOffset(-1),
    },
    {
      id: 'prod-02',
      name: 'Argan & Rosemary Growth Hair Oil 100ml',
      brand: 'Whispers Botanicals',
      sku: 'WC-OIL-102',
      barcode: '6164001001021',
      category: 'Hair Oil',
      costPrice: 680,
      basePrice: 1150,
      currentPrice: 1250,
      autoDynamicPricing: true,
      stock: 5,
      reorderLevel: 6,
      isPerishable: true,
      expiryDate: dateDaysOffset(210),
      imageUrl: 'preset:hair_oil',
      updatedAt: isoDaysOffset(0, 8, 30),
    },
    {
      id: 'prod-03',
      name: 'Radiance Niacinamide Beauty Cream 50ml',
      brand: 'Aurélia Glow',
      sku: 'WC-CRM-103',
      barcode: '6164001001038',
      category: 'Beauty Cream',
      costPrice: 900,
      basePrice: 1500,
      currentPrice: 1500,
      autoDynamicPricing: false,
      stock: 14,
      reorderLevel: 6,
      isPerishable: true,
      expiryDate: dateDaysOffset(14),
      imageUrl: 'preset:beauty_cream',
      updatedAt: isoDaysOffset(-2),
    },
    {
      id: 'prod-04',
      name: 'Turmeric & Raw Honey Beauty Soap Bar',
      brand: 'Botanica Pure',
      sku: 'WC-SOP-104',
      barcode: '6164001001045',
      category: 'Beauty Soaps',
      costPrice: 180,
      basePrice: 350,
      currentPrice: 350,
      autoDynamicPricing: true,
      stock: 28,
      reorderLevel: 10,
      isPerishable: true,
      expiryDate: dateDaysOffset(300),
      imageUrl: 'preset:beauty_soap',
      updatedAt: isoDaysOffset(-3),
    },
    {
      id: 'prod-05',
      name: 'Rose Amber & Musk Body Mist Spray 100ml',
      brand: 'Aurora Mist',
      sku: 'WC-BSP-105',
      barcode: '6164001001052',
      category: 'Body Spray',
      costPrice: 600,
      basePrice: 1050,
      currentPrice: 1050,
      autoDynamicPricing: false,
      stock: 16,
      reorderLevel: 5,
      isPerishable: false,
      expiryDate: null,
      imageUrl: 'preset:body_spray',
      updatedAt: isoDaysOffset(-4),
    },
    {
      id: 'prod-06',
      name: 'Xpression Pre-Stretched Braids 58" (1B)',
      brand: 'Darling Pro',
      sku: 'WC-BRD-106',
      barcode: '6164001001069',
      category: 'Braids',
      costPrice: 280,
      basePrice: 480,
      currentPrice: 480,
      autoDynamicPricing: true,
      stock: 4,
      reorderLevel: 12,
      isPerishable: false,
      expiryDate: null,
      imageUrl: '',
      updatedAt: isoDaysOffset(0, 9, 10),
    },
    {
      id: 'prod-07',
      name: 'Olive Miracle Holding Hair Spray 250ml',
      brand: 'SilkHold',
      sku: 'WC-HSP-107',
      barcode: '6164001001076',
      category: 'Hair Spray',
      costPrice: 420,
      basePrice: 720,
      currentPrice: 720,
      autoDynamicPricing: false,
      stock: 11,
      reorderLevel: 6,
      isPerishable: false,
      expiryDate: null,
      imageUrl: 'preset:body_spray',
      updatedAt: isoDaysOffset(-5),
    },
    {
      id: 'prod-08',
      name: 'Gentle Chamomile Baby Jelly & Lotion Set',
      brand: 'CuddlePure',
      sku: 'WC-BBY-108',
      barcode: '6164001001083',
      category: 'Baby Products',
      costPrice: 490,
      basePrice: 820,
      currentPrice: 820,
      autoDynamicPricing: false,
      stock: 12,
      reorderLevel: 5,
      isPerishable: true,
      expiryDate: dateDaysOffset(95),
      imageUrl: 'preset:lotion',
      updatedAt: isoDaysOffset(-2),
    },
    {
      id: 'prod-09',
      name: 'No-Lye Conditioning Relaxer Kit (Regular)',
      brand: 'KeratinLux',
      sku: 'WC-CHM-109',
      barcode: '6164001001090',
      category: 'Hair Products - Chemical',
      costPrice: 540,
      basePrice: 920,
      currentPrice: 920,
      autoDynamicPricing: false,
      stock: 9,
      reorderLevel: 5,
      isPerishable: true,
      expiryDate: dateDaysOffset(-3),
      imageUrl: '',
      updatedAt: isoDaysOffset(-6),
    },
    {
      id: 'prod-10',
      name: 'Avocado & Coconut Conditioning Hair Food 200g',
      brand: 'Whispers Botanicals',
      sku: 'WC-HFD-110',
      barcode: '6164001001106',
      category: 'Hair Products - Hair Food',
      costPrice: 310,
      basePrice: 550,
      currentPrice: 550,
      autoDynamicPricing: true,
      stock: 19,
      reorderLevel: 8,
      isPerishable: true,
      expiryDate: dateDaysOffset(180),
      imageUrl: 'preset:beauty_cream',
      updatedAt: isoDaysOffset(-1),
    },
  ];

  const transactions: SaleTransaction[] = [
    {
      id: 'tx-1001',
      receiptNo: 'WC-2401',
      items: [
        {
          productId: 'prod-02',
          productName: 'Argan & Rosemary Growth Hair Oil 100ml',
          category: 'Hair Oil',
          quantity: 3,
          unitPrice: 1250,
          costPrice: 680,
        },
        {
          productId: 'prod-04',
          productName: 'Turmeric & Raw Honey Beauty Soap Bar',
          category: 'Beauty Soaps',
          quantity: 2,
          unitPrice: 350,
          costPrice: 180,
        },
      ],
      totalAmount: 4450,
      paymentMode: 'Mpesa',
      mpesaDetails: {
        transactionCode: 'UK49L82TXA',
        senderName: 'MERCY CHEBET',
        senderPhone: '0721459820',
        amountReceived: 4450,
        rawMessage:
          'UK49L82TXA Confirmed. Ksh4,450.00 received from MERCY CHEBET 0721459820 via Till 5482910 on today at 9:42 AM.',
        verified: true,
        timestamp: 'Today 9:42 AM',
      },
      createdAt: isoDaysOffset(0, 9, 42),
    },
    {
      id: 'tx-1002',
      receiptNo: 'WC-2402',
      items: [
        {
          productId: 'prod-06',
          productName: 'Xpression Pre-Stretched Braids 58" (1B)',
          category: 'Braids',
          quantity: 4,
          unitPrice: 480,
          costPrice: 280,
        },
        {
          productId: 'prod-01',
          productName: 'Whipped Shea & Rosehip Body Lotion 400ml',
          category: 'Lotion',
          quantity: 2,
          unitPrice: 850,
          costPrice: 520,
        },
      ],
      totalAmount: 3620,
      paymentMode: 'Cash',
      createdAt: isoDaysOffset(0, 10, 18),
    },
    {
      id: 'tx-1003',
      receiptNo: 'WC-2403',
      items: [
        {
          productId: 'prod-02',
          productName: 'Argan & Rosemary Growth Hair Oil 100ml',
          category: 'Hair Oil',
          quantity: 4,
          unitPrice: 1150,
          costPrice: 680,
        },
        {
          productId: 'prod-05',
          productName: 'Rose Amber & Musk Body Mist Spray 100ml',
          category: 'Body Spray',
          quantity: 2,
          unitPrice: 1050,
          costPrice: 600,
        },
      ],
      totalAmount: 6700,
      paymentMode: 'Mpesa',
      mpesaDetails: {
        transactionCode: 'UK31M74QWE',
        senderName: 'SHARON OTIENO',
        senderPhone: '0711902344',
        amountReceived: 6700,
        rawMessage:
          'UK31M74QWE Confirmed. Ksh6,700.00 received from SHARON OTIENO 0711902344 via Till 5482910.',
        verified: true,
        timestamp: '2 days ago',
      },
      createdAt: isoDaysOffset(-2, 14, 15),
    },
    {
      id: 'tx-1004',
      receiptNo: 'WC-2404',
      items: [
        {
          productId: 'prod-06',
          productName: 'Xpression Pre-Stretched Braids 58" (1B)',
          category: 'Braids',
          quantity: 5,
          unitPrice: 480,
          costPrice: 280,
        },
        {
          productId: 'prod-10',
          productName: 'Avocado & Coconut Conditioning Hair Food 200g',
          category: 'Hair Products - Hair Food',
          quantity: 3,
          unitPrice: 550,
          costPrice: 310,
        },
      ],
      totalAmount: 4050,
      paymentMode: 'Cash',
      createdAt: isoDaysOffset(-4, 16, 40),
    },
    {
      id: 'tx-1005',
      receiptNo: 'WC-2405',
      items: [
        {
          productId: 'prod-01',
          productName: 'Whipped Shea & Rosehip Body Lotion 400ml',
          category: 'Lotion',
          quantity: 5,
          unitPrice: 850,
          costPrice: 520,
        },
        {
          productId: 'prod-08',
          productName: 'Gentle Chamomile Baby Jelly & Lotion Set',
          category: 'Baby Products',
          quantity: 2,
          unitPrice: 820,
          costPrice: 490,
        },
      ],
      totalAmount: 5890,
      paymentMode: 'Mpesa',
      mpesaDetails: {
        transactionCode: 'UK12P66ZRT',
        senderName: 'BEATRICE NJERI',
        senderPhone: '0729334120',
        amountReceived: 5890,
        rawMessage:
          'UK12P66ZRT Confirmed. Ksh5,890.00 received from BEATRICE NJERI 0729334120 via Till 5482910.',
        verified: true,
        timestamp: '5 days ago',
      },
      createdAt: isoDaysOffset(-5, 12, 5),
    },
  ];

  const credits: CreditRecord[] = [
    {
      id: 'cred-01',
      creditorName: 'Lilian Wambui (Velvet Salon)',
      creditorPhone: '0718442190',
      pendingDate: dateDaysOffset(-3),
      dueDate: dateDaysOffset(4),
      items: [
        {
          productId: 'prod-06',
          productName: 'Xpression Pre-Stretched Braids 58" (1B)',
          category: 'Braids',
          quantity: 4,
          unitPrice: 480,
          costPrice: 280,
        },
        {
          productId: 'prod-07',
          productName: 'Olive Miracle Holding Hair Spray 250ml',
          category: 'Hair Spray',
          quantity: 2,
          unitPrice: 720,
          costPrice: 420,
        },
      ],
      totalAmount: 3360,
      amountPaid: 1500,
      notes: 'Paid deposit via M-Pesa, balance on Friday salon restock',
      payments: [
        {
          id: 'cp-01',
          amount: 1500,
          method: 'Mpesa',
          mpesaDetails: {
            transactionCode: 'UK28J55KLM',
            senderName: 'LILIAN WAMBUI',
            senderPhone: '0718442190',
            amountReceived: 1500,
            rawMessage: 'UK28J55KLM Confirmed. Ksh1,500.00 received from LILIAN WAMBUI 0718442190.',
            verified: true,
            timestamp: dateDaysOffset(-2),
          },
          paidAt: isoDaysOffset(-2, 15, 0),
          note: 'Initial deposit',
        },
      ],
      createdAt: isoDaysOffset(-3, 11, 0),
      updatedAt: isoDaysOffset(-2, 15, 0),
    },
    {
      id: 'cred-02',
      creditorName: 'Diana Achieng',
      creditorPhone: '0705991823',
      pendingDate: dateDaysOffset(-9),
      dueDate: dateDaysOffset(-2),
      items: [
        {
          productId: 'prod-03',
          productName: 'Radiance Niacinamide Beauty Cream 50ml',
          category: 'Beauty Cream',
          quantity: 1,
          unitPrice: 1500,
          costPrice: 900,
        },
        {
          productId: 'prod-05',
          productName: 'Rose Amber & Musk Body Mist Spray 100ml',
          category: 'Body Spray',
          quantity: 1,
          unitPrice: 1050,
          costPrice: 600,
        },
      ],
      totalAmount: 2550,
      amountPaid: 0,
      notes: 'Regular customer — promised settlement this week',
      payments: [],
      createdAt: isoDaysOffset(-9, 13, 25),
      updatedAt: isoDaysOffset(-9, 13, 25),
    },
  ];

  const settings: StoreSettings = {
    storeName: 'Whispers Cosmetics',
    logoUrl: '',
    pin: '1234',
    currency: 'Ksh',
    mpesaTillNumber: '5482910',
    autoDynamicEnabled: false,
    theme: 'light',
  };

  return { products, transactions, credits, settings };
}

function readDb(): AppDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const seed = createSeedDatabase();
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw) as AppDatabase;
  } catch {
    const seed = createSeedDatabase();
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}

function writeDb(db: AppDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/data', (_req, res) => {
    const db = readDb();
    res.json(db);
  });

  app.post('/api/auth/verify-pin', (req, res) => {
    const { pin } = req.body as { pin?: string };
    const db = readDb();
    if (pin && pin === db.settings.pin) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ valid: false, message: 'Incorrect PIN. Try again.' });
    }
  });

  app.post('/api/products', (req, res) => {
    const db = readDb();
    const payload = req.body as Omit<Product, 'id' | 'updatedAt'>;
    const newProduct: Product = {
      ...payload,
      id: `prod-${Date.now().toString(36)}`,
      updatedAt: new Date().toISOString(),
    };
    db.products.unshift(newProduct);
    writeDb(db);
    res.status(201).json(newProduct);
  });

  app.put('/api/products/:id', (req, res) => {
    const db = readDb();
    const idx = db.products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const updated: Product = {
      ...db.products[idx],
      ...req.body,
      id: db.products[idx].id,
      updatedAt: new Date().toISOString(),
    };
    db.products[idx] = updated;
    writeDb(db);
    res.json(updated);
  });

  app.delete('/api/products/:id', (req, res) => {
    const db = readDb();
    db.products = db.products.filter((p) => p.id !== req.params.id);
    writeDb(db);
    res.json({ deleted: true });
  });

  app.post('/api/transactions', (req, res) => {
    const db = readDb();
    const {
      items,
      totalAmount,
      paymentMode,
      mpesaDetails,
      creditorName,
      creditorPhone,
      pendingDate,
      dueDate,
      creditNotes,
      initialDeposit,
    } = req.body as {
      items: SaleTransaction['items'];
      totalAmount: number;
      paymentMode: SaleTransaction['paymentMode'];
      mpesaDetails?: SaleTransaction['mpesaDetails'];
      creditorName?: string;
      creditorPhone?: string;
      pendingDate?: string;
      dueDate?: string;
      creditNotes?: string;
      initialDeposit?: number;
    };

    // Deduct stock
    for (const item of items) {
      const prod = db.products.find((p) => p.id === item.productId);
      if (prod) {
        prod.stock = Math.max(0, prod.stock - item.quantity);
        prod.updatedAt = new Date().toISOString();
      }
    }

    const nowIso = new Date().toISOString();
    const receiptNo = `WC-${Math.floor(2406 + db.transactions.length)}`;
    let creditRecord: CreditRecord | undefined;

    if (paymentMode === 'Credit') {
      const deposit = Math.max(0, Math.min(totalAmount, Number(initialDeposit || 0)));
      const initialPayments: CreditPayment[] =
        deposit > 0
          ? [
              {
                id: `cp-${Date.now().toString(36)}`,
                amount: deposit,
                method: 'Cash',
                paidAt: nowIso,
                note: 'Deposit at checkout',
              },
            ]
          : [];

      creditRecord = {
        id: `cred-${Date.now().toString(36)}`,
        creditorName: (creditorName || 'Walk-in Creditor').trim(),
        creditorPhone: (creditorPhone || '').trim(),
        pendingDate: pendingDate || nowIso.slice(0, 10),
        dueDate: dueDate || dateDaysOffset(7),
        items,
        totalAmount,
        amountPaid: deposit,
        notes: (creditNotes || '').trim(),
        payments: initialPayments,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.credits.unshift(creditRecord);
    }

    const tx: SaleTransaction = {
      id: `tx-${Date.now().toString(36)}`,
      receiptNo,
      items,
      totalAmount,
      paymentMode,
      mpesaDetails,
      creditRecordId: creditRecord?.id,
      createdAt: nowIso,
    };

    db.transactions.unshift(tx);
    writeDb(db);
    res.status(201).json({ transaction: tx, creditRecord, products: db.products });
  });

  app.post('/api/credits', (req, res) => {
    const db = readDb();
    const body = req.body as Partial<CreditRecord>;
    const nowIso = new Date().toISOString();
    const record: CreditRecord = {
      id: `cred-${Date.now().toString(36)}`,
      creditorName: (body.creditorName || 'Unnamed Creditor').trim(),
      creditorPhone: (body.creditorPhone || '').trim(),
      pendingDate: body.pendingDate || nowIso.slice(0, 10),
      dueDate: body.dueDate || dateDaysOffset(7),
      items: body.items || [],
      totalAmount: Number(body.totalAmount || 0),
      amountPaid: Number(body.amountPaid || 0),
      notes: (body.notes || '').trim(),
      payments: body.payments || [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    db.credits.unshift(record);
    writeDb(db);
    res.status(201).json(record);
  });

  app.put('/api/credits/:id', (req, res) => {
    const db = readDb();
    const idx = db.credits.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Credit record not found' });
      return;
    }
    const existing = db.credits[idx];
    const updated: CreditRecord = {
      ...existing,
      creditorName: req.body.creditorName ?? existing.creditorName,
      creditorPhone: req.body.creditorPhone ?? existing.creditorPhone,
      pendingDate: req.body.pendingDate ?? existing.pendingDate,
      dueDate: req.body.dueDate ?? existing.dueDate,
      notes: req.body.notes ?? existing.notes,
      totalAmount: req.body.totalAmount !== undefined ? Number(req.body.totalAmount) : existing.totalAmount,
      updatedAt: new Date().toISOString(),
    };
    db.credits[idx] = updated;
    writeDb(db);
    res.json(updated);
  });

  app.post('/api/credits/:id/payments', (req, res) => {
    const db = readDb();
    const idx = db.credits.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Credit record not found' });
      return;
    }
    const record = db.credits[idx];
    const { amount, method, mpesaDetails, note } = req.body as {
      amount: number;
      method: 'Cash' | 'Mpesa';
      mpesaDetails?: CreditPayment['mpesaDetails'];
      note?: string;
    };

    const payAmt = Math.max(0, Number(amount || 0));
    const payment: CreditPayment = {
      id: `cp-${Date.now().toString(36)}`,
      amount: payAmt,
      method,
      mpesaDetails,
      paidAt: new Date().toISOString(),
      note: note?.trim(),
    };

    record.payments.unshift(payment);
    record.amountPaid = Math.min(record.totalAmount, record.amountPaid + payAmt);
    record.updatedAt = new Date().toISOString();

    db.credits[idx] = record;
    writeDb(db);
    res.json(record);
  });

  app.put('/api/settings', (req, res) => {
    const db = readDb();
    db.settings = {
      ...db.settings,
      ...req.body,
    };
    writeDb(db);
    res.json(db.settings);
  });

  const PORT = 3000;
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        },
        appType: 'spa',
      }),
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Whispers Cosmetics server listening on http://localhost:${PORT}`);
    });
    await vitePromise;
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Whispers Cosmetics server listening on http://localhost:${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start Whispers Cosmetics server:', err);
  process.exit(1);
});
