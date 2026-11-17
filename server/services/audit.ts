import type { DatabaseSync } from 'node:sqlite';
import type { AuditEntry } from '../../src/types';
import { all, get } from '../db';
import { addDaysToDateOnly, isDateOnly } from '../time';

interface AuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details_json: string;
  ip: string;
  created_at: string;
}

export interface AuditListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  action?: string;
  from?: string;
  to?: string;
}

export function listAudit(
  db: DatabaseSync,
  options: AuditListOptions = {},
): { entries: AuditEntry[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.search) {
    const term = `%${options.search}%`;
    where.push('(action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR details_json LIKE ?)');
    params.push(term, term, term, term);
  }
  if (options.action) {
    where.push('action = ?');
    params.push(options.action);
  }
  if (options.from && isDateOnly(options.from)) {
    where.push('created_at >= ?');
    params.push(`${options.from}T00:00:00.000Z`);
  }
  if (options.to && isDateOnly(options.to)) {
    where.push('created_at < ?');
    params.push(`${addDaysToDateOnly(options.to, 1)}T00:00:00.000Z`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const count = get<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM audit_log ${clause}`,
    ...params,
  );
  const rows = all<AuditRow>(
    db,
    `SELECT * FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return {
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details_json,
      createdAt: row.created_at,
    })),
    total: Number(count?.count ?? 0),
  };
}
