import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(serverDir, '..');

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const mpesaEnvironment = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
const mpesaShortcode = (process.env.MPESA_SHORTCODE ?? '').trim();
const mpesaCallbackSecret = (process.env.MPESA_CALLBACK_SECRET ?? '').trim();
const configuredCallbackUrl = (process.env.MPESA_CALLBACK_URL ?? '').trim();
const appUrl = (process.env.APP_URL ?? '').trim().replace(/\/$/, '');
const derivedCallbackUrl =
  mpesaCallbackSecret && appUrl ? `${appUrl}/api/mpesa/callback/${mpesaCallbackSecret}` : '';

const mpesaMissing: string[] = [];
if (!process.env.MPESA_CONSUMER_KEY) mpesaMissing.push('MPESA_CONSUMER_KEY');
if (!process.env.MPESA_CONSUMER_SECRET) mpesaMissing.push('MPESA_CONSUMER_SECRET');
if (!process.env.MPESA_PASSKEY) mpesaMissing.push('MPESA_PASSKEY');
if (!mpesaShortcode) mpesaMissing.push('MPESA_SHORTCODE');
if (!mpesaCallbackSecret) mpesaMissing.push('MPESA_CALLBACK_SECRET');
if (!configuredCallbackUrl && !derivedCallbackUrl) mpesaMissing.push('MPESA_CALLBACK_URL or APP_URL');

export const config = {
  version: readVersion(),
  appName: 'Whispers Cosmetics',
  port: envInt('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(PROJECT_ROOT, 'data')),
  distDir: path.join(PROJECT_ROOT, 'dist'),
  legacySeedPath: path.join(PROJECT_ROOT, 'data', 'whispers_db.json'),
  seedLegacy: envBool('SEED_LEGACY', true),
  timezone: process.env.STORE_TIMEZONE || 'Africa/Nairobi',
  cashierName: (process.env.CASHIER_NAME ?? '').trim() || 'Main Register',
  trustProxy: envBool('TRUST_PROXY', false),
  cookieSecure: envBool('COOKIE_SECURE', false),
  sessionDays: envInt('SESSION_DAYS', 7),
  isProduction:
    process.env.NODE_ENV === 'production' || process.argv.includes('--production'),
  mpesa: {
    enabled: Boolean(process.env.MPESA_CONSUMER_KEY) && mpesaMissing.length === 0,
    missing: mpesaMissing,
    environment: mpesaEnvironment as 'sandbox' | 'production',
    consumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
    passkey: process.env.MPESA_PASSKEY ?? '',
    shortcode: mpesaShortcode,
    transactionType:
      process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
    callbackUrl: configuredCallbackUrl || derivedCallbackUrl,
    callbackSecret: mpesaCallbackSecret,
    baseUrl:
      mpesaEnvironment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke',
  },
  manualMpesaEnabled: envBool('MANUAL_MPESA_ENABLED', true),
};

export type AppConfig = typeof config;

export function uploadsDir(): string {
  return path.join(config.dataDir, 'uploads');
}

export function backupsDir(): string {
  return path.join(config.dataDir, 'backups');
}

export function databasePath(): string {
  return path.join(config.dataDir, 'whispers.db');
}
