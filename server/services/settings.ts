import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SettingsRow } from '../db';
import { get, run } from '../db';
import { HttpError } from '../errors';
import { hashPin, verifyPin } from '../password';
import { logAudit } from '../audit';
import { optionalBoolean, optionalString, oneOf, requiredString } from '../validation';
import type { StoreSettings } from '../../src/types';
import { sanitizeImageUrl } from './images';
import { uploadsDir } from '../config';

export interface SettingsWithSecret extends StoreSettings {
  pinHash: string;
}

export function mapSettings(row: SettingsRow): SettingsWithSecret {
  return {
    storeName: row.store_name,
    logoUrl: row.logo_url,
    currency: row.currency,
    mpesaTillNumber: row.mpesa_till_number,
    autoDynamicEnabled: row.auto_dynamic_enabled === 1,
    theme: row.theme === 'dark' ? 'dark' : 'light',
    receiptFooter: row.receipt_footer,
    pinIsDefault: row.pin_is_default === 1,
    pinHash: row.pin_hash,
  };
}

export function getSettingsRow(db: DatabaseSync): SettingsRow {
  const row = get<SettingsRow>(db, 'SELECT * FROM settings WHERE id = 1');
  if (!row) throw new HttpError(500, 'Store settings are missing.');
  return row;
}

export function getSettings(db: DatabaseSync): StoreSettings {
  const { pinHash: _pinHash, ...safe } = mapSettings(getSettingsRow(db));
  return safe;
}

export function publicBranding(db: DatabaseSync): {
  storeName: string;
  logoUrl: string;
  currency: string;
  theme: 'light' | 'dark';
  pinIsDefault: boolean;
} {
  const row = getSettingsRow(db);
  return {
    storeName: row.store_name,
    logoUrl: row.logo_url,
    currency: row.currency,
    theme: row.theme === 'dark' ? 'dark' : 'light',
    pinIsDefault: row.pin_is_default === 1,
  };
}

export function updateSettings(
  db: DatabaseSync,
  body: Record<string, unknown>,
  ip: string,
): StoreSettings {
  const row = getSettingsRow(db);
  const storeName =
    body.storeName !== undefined
      ? requiredString(body.storeName, 'Business name', { max: 80 })
      : row.store_name;
  const currency =
    body.currency !== undefined ? requiredString(body.currency, 'Currency symbol', { max: 8 }) : row.currency;
  const till =
    body.mpesaTillNumber !== undefined
      ? optionalString(body.mpesaTillNumber, 'M-Pesa till number', { max: 20 })
      : row.mpesa_till_number;
  const receiptFooter =
    body.receiptFooter !== undefined
      ? optionalString(body.receiptFooter, 'Receipt footer', { max: 200 })
      : row.receipt_footer;
  const autoDynamic =
    body.autoDynamicEnabled !== undefined
      ? optionalBoolean(body.autoDynamicEnabled, row.auto_dynamic_enabled === 1)
      : row.auto_dynamic_enabled === 1;
  const theme =
    body.theme !== undefined
      ? oneOf(body.theme, ['light', 'dark'] as const, 'Theme')
      : row.theme;
  const logoUrl =
    body.logoUrl !== undefined ? sanitizeImageUrl(body.logoUrl) : row.logo_url;

  run(
    db,
    `UPDATE settings SET store_name = ?, logo_url = ?, currency = ?, mpesa_till_number = ?,
      auto_dynamic_enabled = ?, theme = ?, receipt_footer = ?, updated_at = ? WHERE id = 1`,
    storeName,
    logoUrl,
    currency,
    till,
    autoDynamic ? 1 : 0,
    theme,
    receiptFooter,
    new Date().toISOString(),
  );

  logAudit(db, {
    action: 'settings.update',
    entityType: 'settings',
    entityId: '1',
    details: {
      storeName,
      currency,
      till,
      autoDynamic,
      theme,
      receiptFooter,
      logoChanged: logoUrl !== row.logo_url,
    },
    ip,
  });

  return getSettings(db);
}

export function changePin(
  db: DatabaseSync,
  body: Record<string, unknown>,
  keepTokenHash: string,
  ip: string,
): { deletedSessions: number } {
  const currentPin = requiredString(body.currentPin, 'Current PIN', { min: 4, max: 4 });
  const newPin = requiredString(body.newPin, 'New PIN', { min: 4, max: 4 });
  if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
    throw new HttpError(400, 'PINs must be exactly 4 digits.');
  }
  if (currentPin === newPin) {
    throw new HttpError(400, 'The new PIN must be different from the current PIN.');
  }
  const row = getSettingsRow(db);
  if (!verifyPin(currentPin, row.pin_hash)) {
    throw new HttpError(401, 'Current PIN is incorrect.');
  }

  run(
    db,
    'UPDATE settings SET pin_hash = ?, pin_is_default = 0, updated_at = ? WHERE id = 1',
    hashPin(newPin),
    new Date().toISOString(),
  );
  const deleted = run(db, 'DELETE FROM sessions WHERE token_hash <> ?', keepTokenHash).changes;
  logAudit(db, {
    action: 'settings.pin_change',
    entityType: 'settings',
    entityId: '1',
    details: { otherSessionsRevoked: deleted },
    ip,
  });
  return { deletedSessions: deleted };
}

export function removeLogoFile(logoUrl: string): void {
  if (!logoUrl.startsWith('/uploads/')) return;
  const filename = path.basename(logoUrl);
  const target = path.join(uploadsDir(), filename);
  if (fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch {
      // ignore
    }
  }
}

export function newUploadName(extension: string): string {
  return `${randomUUID()}.${extension}`;
}
