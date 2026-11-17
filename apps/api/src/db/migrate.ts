import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** Applies pending *.sql files in name order, each in its own transaction. Returns applied versions. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ version: string }>(`select version from schema_migrations`)).rows.map((r) => r.version));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    const version = f.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query(`insert into schema_migrations(version) values ($1)`, [version]);
    });
    applied.push(version);
  }
  return applied;
}
