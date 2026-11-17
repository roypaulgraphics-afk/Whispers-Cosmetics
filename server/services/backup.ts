import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupsDir, databasePath } from '../config';
import { createBackup } from '../db';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return { name: file, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createBackupNow(db: DatabaseSync): BackupInfo | null {
  const target = createBackup(db, databasePath());
  if (!target) return null;
  const stat = fs.statSync(target);
  return { name: path.basename(target), size: stat.size, createdAt: stat.mtime.toISOString() };
}

export function resolveBackup(name: string): { absolute: string; info: BackupInfo } | null {
  if (!/^[A-Za-z0-9._-]+\.db$/.test(name) || name.includes('..')) return null;
  const absolute = path.join(backupsDir(), name);
  if (!absolute.startsWith(backupsDir() + path.sep)) return null;
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  return {
    absolute,
    info: { name, size: stat.size, createdAt: stat.mtime.toISOString() },
  };
}

export function backupRetentionDays(): number {
  return 14;
}

export function autoBackupDue(lastBackupAt: string | null): boolean {
  if (!lastBackupAt) return true;
  const age = Date.now() - new Date(lastBackupAt).getTime();
  if (!Number.isFinite(age)) return true;
  return age >= 24 * 60 * 60 * 1000;
}

export function latestBackupAt(): string | null {
  return listBackups()[0]?.createdAt ?? null;
}
