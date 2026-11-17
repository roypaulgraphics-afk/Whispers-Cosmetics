import type { DatabaseSync } from 'node:sqlite';
import { run } from './db';

export function logAudit(
  db: DatabaseSync,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    ip?: string;
  },
): void {
  try {
    run(
      db,
      `INSERT INTO audit_log (action, entity_type, entity_id, details_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? '',
      new Date().toISOString(),
    );
  } catch (error) {
    console.error('Failed to write audit log', error);
  }
}
