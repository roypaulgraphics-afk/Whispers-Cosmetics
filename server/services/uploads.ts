import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '../errors';
import { logAudit } from '../audit';
import { uploadsDir } from '../config';
import { newId } from '../db';

const MAX_BYTES = 3 * 1024 * 1024;

function sniffImage(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function saveUploadedImage(
  db: DatabaseSync,
  body: Record<string, unknown>,
  ip: string,
): { url: string } {
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new HttpError(400, 'Upload a PNG, JPEG or WEBP image.');
  }
  const declared = match[1] === 'jpg' ? 'jpeg' : match[1];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    throw new HttpError(400, 'The uploaded image could not be decoded.');
  }
  if (buffer.length === 0) throw new HttpError(400, 'The uploaded image is empty.');
  if (buffer.length > MAX_BYTES) {
    throw new HttpError(413, 'Image is too large. Keep it under 3 MB.');
  }
  const sniffed = sniffImage(buffer);
  if (!sniffed) throw new HttpError(400, 'The file is not a valid PNG, JPEG or WEBP image.');
  if (sniffed !== declared) {
    throw new HttpError(400, 'Image type does not match its contents.');
  }

  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const extension = sniffed === 'jpeg' ? 'jpg' : sniffed;
  const filename = `${randomUUID()}.${extension}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  logAudit(db, {
    action: 'image.upload',
    entityType: 'upload',
    entityId: filename,
    details: { bytes: buffer.length, type: sniffed, kind: String(body.kind ?? 'product') },
    ip,
  });

  return { url: `/uploads/${filename}` };
}

export function deleteUploadedImage(db: DatabaseSync, url: string, ip: string): void {
  if (!url.startsWith('/uploads/')) return;
  const filename = path.basename(url);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return;
  const target = path.join(uploadsDir(), filename);
  if (!fs.existsSync(target)) return;
  try {
    fs.unlinkSync(target);
    logAudit(db, {
      action: 'image.delete',
      entityType: 'upload',
      entityId: filename,
      ip,
    });
  } catch {
    // ignore cleanup failures
  }
}

export function unusedId(): string {
  return newId('upload');
}
