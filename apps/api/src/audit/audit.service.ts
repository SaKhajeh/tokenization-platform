import { Inject, Injectable } from "@nestjs/common";
import { DB, type Db, type Queryable } from "../db/db.js";
import { canonicalJson, sha256Hex } from "../common/crypto.js";

export const GENESIS_HASH = "0".repeat(64);
const AUDIT_LOCK = 7_243_001; // pg_advisory_xact_lock key: serialises appends so the chain never forks

export interface AuditEntry {
  actorUserId?: string | null;
  actorType?: "user" | "staff" | "system";
  orgId?: string | null;
  action: string; // e.g. "org.created", "member.role_changed"
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  deviceId?: string | null;
}

interface Row {
  id: string;
  at: Date | string;
  actor_user_id: string | null;
  actor_type: string;
  org_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  device_id: string | null;
  prev_hash: string;
  hash: string;
}

/** The exact fields covered by each entry's hash. */
function payload(r: Omit<Row, "id" | "prev_hash" | "hash">) {
  return canonicalJson({
    at: new Date(r.at).toISOString(),
    actor_user_id: r.actor_user_id,
    actor_type: r.actor_type,
    org_id: r.org_id,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    before: r.before ?? null,
    after: r.after ?? null,
    ip: r.ip,
    device_id: r.device_id,
  });
}
const chainHash = (prev: string, p: string) => sha256Hex(`${prev}|${p}`);

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Append within the caller's transaction, so the audit row commits or rolls back with the change. */
  async append(q: Queryable, e: AuditEntry): Promise<string> {
    await q.query(`select pg_advisory_xact_lock($1)`, [AUDIT_LOCK]);
    const last = await q.query<{ hash: string }>(`select hash from audit_log order by id desc limit 1`);
    const prev = last.rows[0]?.hash ?? GENESIS_HASH;
    const row = {
      at: new Date(new Date().toISOString()), // ms precision, round-trips through timestamptz
      actor_user_id: e.actorUserId ?? null,
      actor_type: e.actorType ?? (e.actorUserId ? "user" : "system"),
      org_id: e.orgId ?? null,
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      before: e.before === undefined ? null : JSON.parse(canonicalJson(e.before)),
      after: e.after === undefined ? null : JSON.parse(canonicalJson(e.after)),
      ip: e.ip ?? null,
      device_id: e.deviceId ?? null,
    };
    const hash = chainHash(prev, payload(row));
    await q.query(
      `insert into audit_log (at, actor_user_id, actor_type, org_id, action, entity_type, entity_id, before, after, ip, device_id, prev_hash, hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [row.at.toISOString(), row.actor_user_id, row.actor_type, row.org_id, row.action, row.entity_type, row.entity_id,
       row.before === null ? null : JSON.stringify(row.before), row.after === null ? null : JSON.stringify(row.after),
       row.ip, row.device_id, prev, hash],
    );
    return hash;
  }

  /** Recomputes the whole chain. Any edited, inserted or removed row breaks it. */
  async verify(): Promise<{ ok: boolean; checked: number; firstBadId: string | null }> {
    const { rows } = await this.db.query<Row>(`select * from audit_log order by id asc`);
    let prev = GENESIS_HASH;
    for (const r of rows) {
      if (r.prev_hash !== prev || chainHash(prev, payload(r)) !== r.hash) return { ok: false, checked: rows.length, firstBadId: String(r.id) };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length, firstBadId: null };
  }

  async list(filter: { entityType?: string; entityId?: string; orgId?: string; limit?: number }) {
    const where: string[] = [];
    const p: unknown[] = [];
    if (filter.entityType) where.push(`entity_type = $${p.push(filter.entityType)}`);
    if (filter.entityId) where.push(`entity_id = $${p.push(filter.entityId)}`);
    if (filter.orgId) where.push(`org_id = $${p.push(filter.orgId)}`);
    const limit = Math.min(filter.limit ?? 50, 200);
    const { rows } = await this.db.query(
      `select id::text as id, at, actor_user_id, actor_type, org_id, action, entity_type, entity_id, before, after, ip, hash
       from audit_log ${where.length ? "where " + where.join(" and ") : ""} order by id desc limit ${limit}`,
      p,
    );
    return rows;
  }
}
