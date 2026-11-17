/** Runs `fn` only if this process holds the named lease; another worker running the same job is skipped. */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/db.js";

const me = `${process.pid}-${randomUUID().slice(0, 8)}`;

export async function withLease<T>(db: Db, name: string, ttlSec: number, fn: () => Promise<T>): Promise<T | null> {
  const got = await db.query(
    `insert into job_leases (name, holder, expires_at) values ($1, $2, now() + ($3 || ' seconds')::interval)
     on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at
     where job_leases.expires_at < now() or job_leases.holder = excluded.holder
     returning holder`,
    [name, me, String(ttlSec)],
  );
  if (!got.rows[0]) return null;
  try {
    return await fn();
  } finally {
    await db.query(`delete from job_leases where name = $1 and holder = $2`, [name, me]);
  }
}
