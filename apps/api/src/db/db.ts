import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { recordInTransaction } from "../common/idempotency-context.js";

/** Minimal SQL surface shared by node-postgres (production) and PGlite (tests). Plain SQL, no ORM. */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs fn in one transaction; rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const DB = Symbol("DB");

// int8 → string (never lose precision on money/ids); numeric → string
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);

export class PgDb implements Db {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 20 });
  }
  query<T = any>(sql: string, params: unknown[] = []) {
    return this.pool.query(sql, params as any[]) as unknown as Promise<{ rows: T[] }>;
  }
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const q: Queryable = {
        query: (s, p = []) => client.query(s, p as any[]) as any,
        exec: async (s) => void (await client.query(s)),
      };
      const out = await fn(q);
      await recordInTransaction(q, out); // the idempotency key's response commits with the business change
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async exec(sql: string) {
    await this.pool.query(sql);
  }
  close() {
    return this.pool.end();
  }
}

export class PgliteDb implements Db {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly pg: PGlite) {}
  query<T = any>(sql: string, params: unknown[] = []) {
    return this.pg.query<T>(sql, params) as Promise<{ rows: T[] }>;
  }
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    // PGlite is single-connection: serialise transactions to mimic a pool.
    const run = this.chain.then(() =>
      this.pg.transaction(async (t) => {
        const q: Queryable = { query: (s, p = []) => t.query(s, p) as any, exec: async (s) => void (await t.exec(s)) };
        const out = await fn(q);
        await recordInTransaction(q, out);
        return out;
      }),
    );
    this.chain = run.catch(() => undefined);
    return run as Promise<T>;
  }
  async exec(sql: string) {
    await this.pg.exec(sql);
  }
  close() {
    return this.pg.close();
  }
}
